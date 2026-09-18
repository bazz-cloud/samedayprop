/**
 * End-to-end flow against a real database.
 *
 * Purchase -> signature -> payment -> provisioning -> risk -> payout ->
 * signed-document evidence, plus the concurrency, idempotency and authorisation
 * invariants that only show up once persistence is involved.
 */

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db';
import { Money, usd } from '@/domain/money/money';
import { hashPassword } from '@/server/auth/passwords';
import { publishCatalogIfEmpty } from '@/server/services/catalog-service';
import {
  createOrder,
  createQuote,
  markOrderPaid,
  recordAcceptance,
  requiredDocuments,
  revalidateQuote,
  signatureStatus,
  CheckoutError,
} from '@/server/services/checkout-service';
import { runProvisioning } from '@/server/services/provisioning-service';
import { ingestSnapshot } from '@/server/services/risk-service';
import {
  PayoutError,
  getPayoutView,
  markPayoutPaid,
  requestPayout,
  resolveReconciliation,
  submitPayout,
  validateAndApprove,
} from '@/server/services/payout-service';
import { verifyLedgersBalance } from '@/server/services/ledger-service';
import { MockTradingProvider } from '@/server/providers/trading/mock';
import { MockPaymentProvider } from '@/server/providers/payments/mock';
import { __setProvidersForTesting } from '@/server/providers/registry';
import { LEGAL_DOCUMENT_DRAFTS, hashDocumentBody } from '@/server/legal/documents';
import { DEFAULT_COUPON } from '@/domain/pricing/coupon';
import { DEFAULT_SESSION_CONFIG, sessionDateFor } from '@/domain/risk/session';
import type { AccountSnapshot } from '@/server/providers/trading/types';

let trading: MockTradingProvider;
let payments: MockPaymentProvider;
let userCounter = 0;

async function seedBaseline(): Promise<void> {
  await publishCatalogIfEmpty();

  const coupon = DEFAULT_COUPON.value;
  await prisma.coupon.upsert({
    where: { code: coupon.code },
    update: {},
    create: {
      code: coupon.code,
      percentOff: Number(coupon.percentOff),
      scope: coupon.scope,
      maxRedemptionsPerCustomer: coupon.maxRedemptionsPerCustomer,
      active: true,
    },
  });

  for (const document of LEGAL_DOCUMENT_DRAFTS) {
    await prisma.legalDocumentVersion.upsert({
      where: { slug_version: { slug: document.slug, version: document.version } },
      update: {},
      create: {
        slug: document.slug,
        version: document.version,
        title: document.title,
        body: document.body,
        bodyHash: hashDocumentBody(document.body),
        status: 'DRAFT_PENDING_LEGAL_REVIEW',
        requiredAtCheckout: true,
      },
    });
  }

  for (const product of [
    { symbol: 'ES', nettingGroup: 'SP', microEquivalentsPerContract: 10, approved: true, description: 'E-mini S&P' },
    { symbol: 'MES', nettingGroup: 'SP', microEquivalentsPerContract: 1, approved: true, description: 'Micro E-mini S&P' },
  ]) {
    await prisma.productRiskConfig.upsert({
      where: { symbol: product.symbol },
      update: {},
      create: product,
    });
  }
}

async function makeUser(): Promise<{ id: string; email: string }> {
  userCounter += 1;
  const email = `trader${userCounter}@example.invalid`;
  const password = await hashPassword('a-sufficiently-long-password');
  const user = await prisma.user.create({
    data: {
      email,
      emailNormalised: email.toLowerCase(),
      emailVerifiedAt: new Date(),
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordParams: password.params,
      legalName: `Test Trader ${userCounter}`,
      role: 'TRADER',
    },
  });
  return { id: user.id, email };
}

/** Sign every required document against a quote. */
async function signEverything(userId: string, quoteId: string): Promise<void> {
  for (const document of await requiredDocuments()) {
    await recordAcceptance({
      userId,
      quoteId,
      documentId: document.id,
      typedLegalName: 'Test Trader',
      consentWording: 'I agree and intend my typed name as my signature.',
      ipAddress: '203.0.113.10',
      userAgent: 'integration-test',
    });
  }
}

/** Buy an account and drive it all the way to active. */
async function provisionAccount(
  planKey = 'SIM_50K',
): Promise<{ userId: string; orderId: string; accountId: string; externalAccountId: string }> {
  const user = await makeUser();
  const { quoteId } = await createQuote({
    planKey,
    addOnKeys: [],
    couponCode: 'START25',
    userId: user.id,
  });
  await signEverything(user.id, quoteId);

  const order = await createOrder({
    userId: user.id,
    quoteId,
    idempotencyKey: `test-order-${user.id}`,
  });

  const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
  await markOrderPaid({
    orderId: order.orderId,
    provider: 'mock-payments',
    providerRef: `mockpi_${order.orderId}`,
    amount: Money.fromMinor(stored.totalMinor),
    fee: usd('13.32'),
    net: Money.fromMinor(stored.totalMinor).minus(usd('13.32')),
    idempotencyKey: `payment:${order.orderId}`,
  });

  const outcome = await runProvisioning(order.orderId);
  expect(outcome.state).toBe('active');

  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { orderId: order.orderId },
  });
  return {
    userId: user.id,
    orderId: order.orderId,
    accountId: account.id,
    externalAccountId: account.externalAccountId!,
  };
}

function snapshotAt(
  externalAccountId: string,
  equity: string,
  sequence: bigint,
  overrides: Partial<AccountSnapshot> = {},
): AccountSnapshot {
  return {
    externalAccountId,
    equity: usd(equity),
    balance: usd(equity),
    unrealised: usd('0.00'),
    commissions: usd('0.00'),
    positions: [],
    workingOrders: [],
    sequence,
    sourceTimestamp: new Date().toISOString(),
    ...overrides,
  };
}

beforeAll(async () => {
  await seedBaseline();
});

beforeEach(async () => {
  trading = new MockTradingProvider();
  payments = new MockPaymentProvider('test-secret');
  __setProvidersForTesting(payments, trading);

  // PlanVersion rows are shared across tests, and several of them approve a
  // lifetime cap to exercise the payout path. Reset to the seeded UNRESOLVED
  // state so each test starts from the same commercial position.
  await prisma.planVersion.updateMany({
    data: {
      lifetimeCapKind: 'UNRESOLVED',
      lifetimeCapMinor: null,
      lifetimeCapApprovedBy: null,
      lifetimeCapApprovedAt: null,
    },
  });
});

// ---------------------------------------------------------------------------

describe('purchase to provisioning', () => {
  it('completes the full flow and leaves the account active', async () => {
    const { orderId, accountId } = await provisionAccount();

    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(order.status).toBe('FULFILLED');

    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.tradingStatus).toBe('ACTIVE');
    expect(account.externalAccountId).toBeTruthy();
    expect(account.balanceMinor).toBe(usd('50000.00').minor);
  });

  it('charges the discounted price and stores an immutable terms snapshot', async () => {
    const { orderId } = await provisionAccount();
    const order = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: true },
    });

    expect(Money.fromMinor(order.totalMinor).toDecimalString()).toBe('449.25');
    expect(Money.fromMinor(order.discountMinor).toDecimalString()).toBe('149.75');

    const snapshot = JSON.parse(order.termsSnapshot) as {
      rules: Record<string, string>;
      requirementStatuses: Record<string, string>;
    };
    expect(snapshot.rules.retainedBufferMinor).toBe('200000');
    expect(snapshot.requirementStatuses.lifetimeCashCap).toBe('UNRESOLVED');
  });

  it('is idempotent: the same key creates exactly one order', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);

    const first = await createOrder({ userId: user.id, quoteId, idempotencyKey: 'dup-key' });
    const second = await createOrder({ userId: user.id, quoteId, idempotencyKey: 'dup-key' });

    expect(second.orderId).toBe(first.orderId);
    expect(second.created).toBe(false);
    expect(await prisma.order.count({ where: { userId: user.id } })).toBe(1);
  });

  it('refuses to create an order without every signature', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });

    await expect(
      createOrder({ userId: user.id, quoteId, idempotencyKey: `unsigned-${user.id}` }),
    ).rejects.toThrow(/sign the required agreements/);
  });

  it('records signature evidence bound to the exact terms', async () => {
    const user = await makeUser();
    const { quoteId, snapshotHash } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);

    const acceptances = await prisma.agreementAcceptance.findMany({ where: { userId: user.id } });
    expect(acceptances.length).toBe(LEGAL_DOCUMENT_DRAFTS.length);
    for (const acceptance of acceptances) {
      expect(acceptance.quoteHash).toBe(snapshotHash);
      expect(acceptance.typedLegalName).toBe('Test Trader');
      expect(acceptance.documentHash).toMatch(/^[0-9a-f]{64}$/);
      expect(acceptance.ipAddress).toBe('203.0.113.10');
    }
  });

  it('rejects an obsolete quote whose price no longer matches', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);

    // Simulate the stored terms drifting from what the catalog now computes.
    await prisma.quote.update({
      where: { id: quoteId },
      data: { snapshotHash: 'stale-hash-from-an-older-price' },
    });

    const revalidated = await revalidateQuote(quoteId);
    expect(revalidated.ok).toBe(false);
    expect(revalidated.reason).toMatch(/changed after you reviewed/);

    await expect(
      createOrder({ userId: user.id, quoteId, idempotencyKey: `stale-${user.id}` }),
    ).rejects.toThrow(CheckoutError);
  });

  it('invalidates a signature taken against different terms', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);
    expect((await signatureStatus(user.id, quoteId)).complete).toBe(true);

    await prisma.quote.update({
      where: { id: quoteId },
      data: { snapshotHash: 'different-terms-entirely' },
    });

    const status = await signatureStatus(user.id, quoteId);
    expect(status.complete).toBe(false);
    expect(status.staleSignatures.length).toBe(LEGAL_DOCUMENT_DRAFTS.length);
  });
});

describe('payment idempotency', () => {
  it('a duplicate webhook does not double-post revenue or double-provision', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);
    const order = await createOrder({
      userId: user.id,
      quoteId,
      idempotencyKey: `dup-webhook-${user.id}`,
    });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });

    const args = {
      orderId: order.orderId,
      provider: 'mock-payments',
      providerRef: `mockpi_dup_${order.orderId}`,
      amount: Money.fromMinor(stored.totalMinor),
      fee: usd('10.00'),
      net: Money.fromMinor(stored.totalMinor).minus(usd('10.00')),
      idempotencyKey: `payment:${order.orderId}`,
    };

    const first = await markOrderPaid(args);
    const second = await markOrderPaid(args);
    const third = await markOrderPaid(args);

    expect(first.alreadyApplied).toBe(false);
    expect(second.alreadyApplied).toBe(true);
    expect(third.alreadyApplied).toBe(true);

    expect(await prisma.payment.count({ where: { orderId: order.orderId } })).toBe(1);
    const entries = await prisma.ledgerEntry.count({
      where: { idempotencyKey: { startsWith: `purchase:${order.orderId}` } },
    });
    expect(entries).toBe(2); // one revenue entry, one cash entry — not four or six

    // Provisioning is also idempotent: two runs, one external account.
    await runProvisioning(order.orderId);
    await runProvisioning(order.orderId);
    expect(await prisma.tradingAccount.count({ where: { orderId: order.orderId } })).toBe(1);
  });

  it('refuses to fulfil an order that was not paid in full', async () => {
    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);
    const order = await createOrder({
      userId: user.id,
      quoteId,
      idempotencyKey: `underpaid-${user.id}`,
    });

    await expect(
      markOrderPaid({
        orderId: order.orderId,
        provider: 'mock-payments',
        providerRef: `mockpi_under_${order.orderId}`,
        amount: usd('1.00'),
        fee: usd('0.00'),
        net: usd('1.00'),
        idempotencyKey: `payment:${order.orderId}`,
      }),
    ).rejects.toThrow(/not match the order total/);
  });
});

describe('an account never goes active without verified risk limits', () => {
  it('holds the account for review when the risk read-back disagrees', async () => {
    trading = new MockTradingProvider({ riskReadBackMismatch: true });
    __setProvidersForTesting(payments, trading);

    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);
    const order = await createOrder({
      userId: user.id,
      quoteId,
      idempotencyKey: `riskfail-${user.id}`,
    });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    await markOrderPaid({
      orderId: order.orderId,
      provider: 'mock-payments',
      providerRef: `mockpi_rf_${order.orderId}`,
      amount: Money.fromMinor(stored.totalMinor),
      fee: usd('0.00'),
      net: Money.fromMinor(stored.totalMinor),
      idempotencyKey: `payment:${order.orderId}`,
    });

    const outcome = await runProvisioning(order.orderId);

    expect(outcome.state).toBe('manual_review');
    const account = await prisma.tradingAccount.findUniqueOrThrow({
      where: { orderId: order.orderId },
    });
    // The external account exists, but trading was never enabled.
    expect(account.externalAccountId).toBeTruthy();
    expect(account.tradingStatus).not.toBe('ACTIVE');

    const event = await prisma.riskEvent.findFirst({
      where: { tradingAccountId: account.id, eventType: 'TRADING_DISABLE_FAILED' },
    });
    expect(event?.actionConfirmed).toBe(false);
  });

  it('retries a transient provisioning failure without creating two accounts', async () => {
    trading = new MockTradingProvider({ failProvisioningTimes: 1 });
    __setProvidersForTesting(payments, trading);

    const user = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: user.id,
    });
    await signEverything(user.id, quoteId);
    const order = await createOrder({
      userId: user.id,
      quoteId,
      idempotencyKey: `retry-${user.id}`,
    });
    const stored = await prisma.order.findUniqueOrThrow({ where: { id: order.orderId } });
    await markOrderPaid({
      orderId: order.orderId,
      provider: 'mock-payments',
      providerRef: `mockpi_rt_${order.orderId}`,
      amount: Money.fromMinor(stored.totalMinor),
      fee: usd('0.00'),
      net: Money.fromMinor(stored.totalMinor),
      idempotencyKey: `payment:${order.orderId}`,
    });

    const first = await runProvisioning(order.orderId);
    expect(first.state).toBe('provisioning_failed_retryable');
    expect(await prisma.tradingAccount.count({ where: { orderId: order.orderId } })).toBe(0);

    const second = await runProvisioning(order.orderId);
    expect(second.state).toBe('active');
    expect(await prisma.tradingAccount.count({ where: { orderId: order.orderId } })).toBe(1);
  });
});

describe('risk ingestion', () => {
  it('raises the trailing threshold on an unrealized peak and never lowers it', async () => {
    const { accountId, externalAccountId } = await provisionAccount();

    await ingestSnapshot(
      accountId,
      snapshotAt(externalAccountId, '52500.00', 11n, { unrealised: usd('500.00') }),
    );
    const afterPeak = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Money.fromMinor(afterPeak.thresholdMinor).toDecimalString()).toBe('50100.00');

    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '50500.00', 12n));
    const afterGiveBack = await prisma.tradingAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(Money.fromMinor(afterGiveBack.thresholdMinor).toDecimalString()).toBe('50100.00');
    expect(Money.fromMinor(afterGiveBack.highWaterMinor).toDecimalString()).toBe('52500.00');
  });

  it('ignores duplicate and out-of-order provider events', async () => {
    const { accountId, externalAccountId } = await provisionAccount();

    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '51000.00', 20n));
    const stale = await ingestSnapshot(accountId, snapshotAt(externalAccountId, '99000.00', 15n));

    expect(stale.applied).toBe(false);
    expect(stale.skipReason).toMatch(/not newer/);

    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Money.fromMinor(account.equityMinor).toDecimalString()).toBe('51000.00');

    const duplicate = await ingestSnapshot(accountId, snapshotAt(externalAccountId, '51000.00', 20n));
    expect(duplicate.applied).toBe(false);
    expect(duplicate.skipReason).toMatch(/Duplicate/);
  });

  it('preserves the raw provider payload alongside our interpretation', async () => {
    const { accountId, externalAccountId } = await provisionAccount();
    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '51000.00', 30n));

    const event = await prisma.providerEvent.findFirst({
      where: { tradingAccountId: accountId, sequence: 30n },
    });
    expect(event).toBeTruthy();
    expect(JSON.parse(event!.rawPayload).equity).toBe('51000.00');
    expect(JSON.parse(event!.normalised).equityMinor).toBe('5100000');
    expect(event!.applied).toBe(true);
  });

  it('breaches, flattens and disables when equity reaches the threshold', async () => {
    const { accountId, externalAccountId } = await provisionAccount();

    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '48000.00', 40n));

    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(account.tradingStatus).toBe('BREACHED');
    expect(account.breachReason).toMatch(/maximum drawdown threshold/);

    const event = await prisma.riskEvent.findFirst({
      where: { tradingAccountId: accountId, eventType: 'TRAILING_BREACH' },
    });
    expect(event?.actionConfirmed).toBe(true);
    expect(trading.isTradingDisabled(externalAccountId)).toBe(true);
  });

  it('records an unconfirmed flatten as unconfirmed rather than claiming success', async () => {
    trading = new MockTradingProvider({ flattenNeverConfirms: true });
    __setProvidersForTesting(payments, trading);

    const { accountId, externalAccountId } = await provisionAccount();
    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '48000.00', 50n));

    const breach = await prisma.riskEvent.findFirst({
      where: { tradingAccountId: accountId, eventType: 'TRAILING_BREACH' },
    });
    expect(breach?.actionConfirmed).toBe(false);

    const alert = await prisma.riskEvent.findFirst({
      where: { tradingAccountId: accountId, eventType: 'TRADING_DISABLE_FAILED' },
    });
    expect(alert?.reason).toMatch(/did not receive confirmation/);
  });
});

describe('payouts end to end', () => {
  async function eligibleAccount() {
    const context = await provisionAccount();
    await ingestSnapshot(context.accountId, snapshotAt(context.externalAccountId, '52500.00', 60n));
    return context;
  }

  it('pays the worked example: $500 gross, $250 cash, $52,000 left', async () => {
    const { userId, accountId } = await eligibleAccount();

    const view = await getPayoutView(accountId);
    expect(view.lifetimeCapBlocked).toBe(true); // unresolved cap blocks by default
    expect(view.lifetimeCapMessage).toMatch(/must approve an amount/);

    // Approve an explicit lifetime cap so payouts can proceed.
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: {
        lifetimeCapKind: 'APPROVED_AMOUNT',
        lifetimeCapMinor: usd('3000.00').minor,
        lifetimeCapApprovedBy: 'owner@example.invalid',
        lifetimeCapApprovedAt: new Date(),
      },
    });

    const approved = await getPayoutView(accountId);
    expect(approved.capacity.eligible).toBe(true);
    expect(approved.capacity.maxGross.toDecimalString()).toBe('500.00');

    const request = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: `payout-${accountId}`,
    });
    expect(request.created).toBe(true);

    const stored = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: request.payoutRequestId },
    });
    expect(Money.fromMinor(stored.cashMinor).toDecimalString()).toBe('250.00');
    expect(Money.fromMinor(stored.balanceAfterMinor).toDecimalString()).toBe('52000.00');
    expect(stored.state).toBe('reserved');

    // Capacity is reserved immediately, before anything settles.
    const reservation = await prisma.payoutReservation.findUniqueOrThrow({
      where: { payoutRequestId: request.payoutRequestId },
    });
    expect(reservation.status).toBe('ACTIVE');
    expect(Money.fromMinor(reservation.cashAmountMinor).toDecimalString()).toBe('250.00');

    expect(await validateAndApprove(request.payoutRequestId)).toBe('approved');
    expect(await submitPayout(request.payoutRequestId)).toBe('submitted');

    // The simulated deduction has been applied, and it is recorded as a
    // withdrawal rather than a trading loss.
    const afterDeduction = await prisma.tradingAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(Money.fromMinor(afterDeduction.balanceMinor).toDecimalString()).toBe('52000.00');
    expect(Money.fromMinor(afterDeduction.sessionWithdrawalsMinor).toDecimalString()).toBe('500.00');

    await markPayoutPaid({
      payoutRequestId: request.payoutRequestId,
      paymentProvider: 'manual',
      paymentRef: 'test-payment-ref',
      actor: 'finance@example.invalid',
    });

    const paid = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: request.payoutRequestId },
    });
    expect(paid.state).toBe('paid');

    const consumed = await prisma.payoutReservation.findUniqueOrThrow({
      where: { payoutRequestId: request.payoutRequestId },
    });
    expect(consumed.status).toBe('CONSUMED');

    // The ledgers: $500 simulated, $250 real cash, and NO revenue.
    const entries = await prisma.ledgerEntry.findMany({
      where: { idempotencyKey: { startsWith: `payout-paid:${request.payoutRequestId}` } },
      include: { lines: true },
    });
    expect(entries.map((e) => e.ledger).sort()).toEqual(['CASH', 'OBLIGATION', 'SIMULATION']);

    const simLine = entries
      .find((e) => e.ledger === 'SIMULATION')!
      .lines.find((l) => l.account === 'SIM_ACCOUNT_EQUITY')!;
    expect(Money.fromMinor(simLine.creditMinor).toDecimalString()).toBe('500.00');

    const cashLine = entries
      .find((e) => e.ledger === 'CASH')!
      .lines.find((l) => l.account === 'CASH_TRADER_REWARDS_PAID')!;
    expect(Money.fromMinor(cashLine.debitMinor).toDecimalString()).toBe('250.00');

    const revenueLines = entries.flatMap((e) =>
      e.lines.filter((l) => l.account.startsWith('REVENUE_')),
    );
    expect(revenueLines).toHaveLength(0);
  });

  it('blocks a payout while the lifetime cap is undecided', async () => {
    const { userId, accountId } = await eligibleAccount();
    await expect(
      requestPayout({
        userId,
        tradingAccountId: accountId,
        gross: usd('500.00'),
        idempotencyKey: `blocked-${accountId}`,
      }),
    ).rejects.toThrow(/must approve an amount or explicitly approve an uncapped policy/);
  });

  it('does not let concurrent requests exceed the daily cap', async () => {
    const { userId, accountId } = await provisionAccount();
    await ingestSnapshot(accountId, snapshotAt(accountId ? (await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } })).externalAccountId! : '', '60000.00', 70n));

    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });

    // The $50K daily cash cap is $1,500, i.e. $3,000 gross.
    const first = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('2000.00'),
      idempotencyKey: `cap-a-${accountId}`,
    });
    expect(first.created).toBe(true);

    await expect(
      requestPayout({
        userId,
        tradingAccountId: accountId,
        gross: usd('2000.00'),
        idempotencyKey: `cap-b-${accountId}`,
      }),
    ).rejects.toThrow(PayoutError);

    // A request that fits the remaining $500 cash / $1,000 gross succeeds.
    const third = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('1000.00'),
      idempotencyKey: `cap-c-${accountId}`,
    });
    expect(third.created).toBe(true);

    const reserved = await prisma.payoutReservation.aggregate({
      where: { tradingAccountId: accountId, status: 'ACTIVE' },
      _sum: { cashAmountMinor: true },
    });
    expect(Money.fromMinor(reserved._sum.cashAmountMinor!).toDecimalString()).toBe('1500.00');
  });

  it('is idempotent on the request key', async () => {
    const { userId, accountId } = await eligibleAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });

    const key = `idem-${accountId}`;
    const first = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: key,
    });
    const second = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: key,
    });

    expect(second.payoutRequestId).toBe(first.payoutRequestId);
    expect(second.created).toBe(false);
    expect(await prisma.payoutRequest.count({ where: { tradingAccountId: accountId } })).toBe(1);
  });

  it('never restores a simulated balance on an unknown payment outcome', async () => {
    const { userId, accountId } = await eligibleAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });

    const request = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: `unknown-${accountId}`,
    });
    await validateAndApprove(request.payoutRequestId);
    await submitPayout(request.payoutRequestId);

    const afterSubmit = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Money.fromMinor(afterSubmit.balanceMinor).toDecimalString()).toBe('52000.00');

    // An unknown outcome leaves the deduction in place and capacity reserved.
    const { markPayoutOutcomeUnknown } = await import('@/server/services/payout-service');
    await markPayoutOutcomeUnknown(request.payoutRequestId, 'Provider timed out');

    const parked = await prisma.payoutRequest.findUniqueOrThrow({
      where: { id: request.payoutRequestId },
    });
    expect(parked.state).toBe('needs_reconciliation');
    expect(parked.outcomeUnknown).toBe(true);

    const stillDeducted = await prisma.tradingAccount.findUniqueOrThrow({
      where: { id: accountId },
    });
    expect(Money.fromMinor(stillDeducted.balanceMinor).toDecimalString()).toBe('52000.00');

    const reservation = await prisma.payoutReservation.findUniqueOrThrow({
      where: { payoutRequestId: request.payoutRequestId },
    });
    expect(reservation.status).toBe('ACTIVE');
  });

  it('restores the balance only once non-payment is CONFIRMED', async () => {
    const { userId, accountId } = await eligibleAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });

    const request = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: `confirmed-${accountId}`,
    });
    await validateAndApprove(request.payoutRequestId);
    await submitPayout(request.payoutRequestId);

    const { markPayoutOutcomeUnknown } = await import('@/server/services/payout-service');
    await markPayoutOutcomeUnknown(request.payoutRequestId, 'Provider timed out');

    const state = await resolveReconciliation({
      payoutRequestId: request.payoutRequestId,
      confirmedNotPaid: true,
      paymentRef: null,
      actor: 'finance@example.invalid',
      reason: 'Provider lookup confirmed the transfer was never created.',
    });
    expect(state).toBe('failed');

    const restored = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Money.fromMinor(restored.balanceMinor).toDecimalString()).toBe('52500.00');
    expect(Money.fromMinor(restored.sessionWithdrawalsMinor).toDecimalString()).toBe('0.00');

    const released = await prisma.payoutReservation.findUniqueOrThrow({
      where: { payoutRequestId: request.payoutRequestId },
    });
    expect(released.status).toBe('RELEASED');
  });

  it('blocks a payout when account data is stale', async () => {
    const { userId, accountId } = await eligibleAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });
    await prisma.tradingAccount.update({
      where: { id: accountId },
      data: { dataStale: true },
    });

    await expect(
      requestPayout({
        userId,
        tradingAccountId: accountId,
        gross: usd('500.00'),
        idempotencyKey: `stale-${accountId}`,
      }),
    ).rejects.toThrow(/fresh authoritative account data/);
  });

  it('attributes a reservation to the session it was requested in', async () => {
    const { userId, accountId } = await eligibleAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_UNCAPPED', lifetimeCapMinor: null },
    });

    const request = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: `session-${accountId}`,
    });

    const reservation = await prisma.payoutReservation.findUniqueOrThrow({
      where: { payoutRequestId: request.payoutRequestId },
    });
    expect(reservation.sessionDate).toBe(sessionDateFor(new Date(), DEFAULT_SESSION_CONFIG.value));
  });
});

describe('authorisation', () => {
  it('refuses a payout request against another customer’s account', async () => {
    const owner = await provisionAccount();
    const intruder = await makeUser();

    await expect(
      requestPayout({
        userId: intruder.id,
        tradingAccountId: owner.accountId,
        gross: usd('500.00'),
        idempotencyKey: `intrusion-${intruder.id}`,
      }),
    ).rejects.toThrow(/belongs to another customer/);
  });

  it('refuses to sign against another customer’s quote', async () => {
    const owner = await makeUser();
    const { quoteId } = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: null,
      userId: owner.id,
    });
    const intruder = await makeUser();
    const documents = await requiredDocuments();

    await expect(
      recordAcceptance({
        userId: intruder.id,
        quoteId,
        documentId: documents[0]!.id,
        typedLegalName: 'Not The Owner',
        consentWording: 'test',
      }),
    ).rejects.toThrow(/belongs to another account/);
  });

  it('does not let a dashboard view leak another customer’s account', async () => {
    const owner = await provisionAccount();
    const intruder = await makeUser();
    const { getDashboardAccount } = await import('@/server/views/dashboard-view');

    expect(await getDashboardAccount(intruder.id, owner.accountId)).toBeNull();
    expect(await getDashboardAccount(owner.userId, owner.accountId)).not.toBeNull();
  });
});

describe('coupon usage under concurrency', () => {
  it('enforces the per-customer limit inside the order transaction', async () => {
    const user = await makeUser();

    // BOTH quotes are created up front, while the coupon is still unused — the
    // shape of a genuine double submission, where two in-flight checkouts each
    // passed the pre-check before either redeemed anything.
    const first = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: 'START25',
      userId: user.id,
    });
    const second = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: 'START25',
      userId: user.id,
    });
    expect(first.couponRejection).toBeNull();
    expect(second.couponRejection).toBeNull();

    await signEverything(user.id, first.quoteId);
    await signEverything(user.id, second.quoteId);

    await createOrder({
      userId: user.id,
      quoteId: first.quoteId,
      idempotencyKey: `coupon-1-${user.id}`,
    });

    // The second order is refused by the check INSIDE the order transaction,
    // which is the only one a concurrent submission cannot slip past.
    await expect(
      createOrder({
        userId: user.id,
        quoteId: second.quoteId,
        idempotencyKey: `coupon-2-${user.id}`,
      }),
    ).rejects.toThrow(/already used that discount code/);

    expect(await prisma.couponRedemption.count({ where: { userId: user.id } })).toBe(1);
  });

  it('shows a later quote that the code is already spent', async () => {
    const user = await makeUser();
    const first = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: 'START25',
      userId: user.id,
    });
    await signEverything(user.id, first.quoteId);
    await createOrder({
      userId: user.id,
      quoteId: first.quoteId,
      idempotencyKey: `coupon-used-${user.id}`,
    });

    const later = await createQuote({
      planKey: 'SIM_25K',
      addOnKeys: [],
      couponCode: 'START25',
      userId: user.id,
    });
    expect(later.couponRejection).toMatch(/already used/);
    // And the quote is priced at full list, not silently discounted anyway.
    expect(later.quote.total.toDecimalString()).toBe('349.00');
  });
});

describe('a paid reset', () => {
  it('restores the starting balance but NOT consumed lifetime payout capacity', async () => {
    const { userId, accountId, externalAccountId } = await provisionAccount();
    const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    await prisma.planVersion.update({
      where: { id: account.planVersionId },
      data: { lifetimeCapKind: 'APPROVED_AMOUNT', lifetimeCapMinor: usd('3000.00').minor },
    });

    // Take a payout so there is lifetime capacity to lose.
    await ingestSnapshot(accountId, snapshotAt(externalAccountId, '52500.00', 80n));
    const payout = await requestPayout({
      userId,
      tradingAccountId: accountId,
      gross: usd('500.00'),
      idempotencyKey: `reset-payout-${accountId}`,
    });
    await validateAndApprove(payout.payoutRequestId);
    await submitPayout(payout.payoutRequestId);
    await markPayoutPaid({
      payoutRequestId: payout.payoutRequestId,
      paymentProvider: 'manual',
      paymentRef: 'ref',
      actor: 'test',
    });

    const before = await getPayoutView(accountId);
    expect(before.context.remainingLifetimeCash?.toDecimalString()).toBe('2750.00');

    // Breach the account, then reset it.
    await prisma.tradingAccount.update({
      where: { id: accountId },
      data: { tradingStatus: 'BREACHED', dataStale: false },
    });

    const { applyReset } = await import('@/server/services/reset-service');
    const order = await prisma.order.create({
      data: {
        userId,
        quoteId: account.orderId ? (await prisma.order.findUniqueOrThrow({ where: { id: account.orderId } })).quoteId : '',
        planVersionId: account.planVersionId,
        status: 'PAID',
        subtotalMinor: usd('589.00').minor,
        discountMinor: 0n,
        taxMinor: 0n,
        totalMinor: usd('589.00').minor,
        termsSnapshot: '{}',
        termsHash: 'reset',
        idempotencyKey: `reset-order-${accountId}`,
      },
    });
    const result = await applyReset({ userId, tradingAccountId: accountId, orderId: order.id });
    expect(result.applied).toBe(true);

    const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(Money.fromMinor(after.balanceMinor).toDecimalString()).toBe('50000.00');
    expect(after.tradingStatus).toBe('ACTIVE');
    expect(after.breachReason).toBeNull();
    expect(after.resetCount).toBe(1);

    // The point of the test: capacity already spent is still spent.
    const afterView = await getPayoutView(accountId);
    expect(afterView.context.remainingLifetimeCash?.toDecimalString()).toBe('2750.00');

    // And the payout record survives.
    expect(await prisma.payoutRequest.count({ where: { tradingAccountId: accountId } })).toBe(1);
  });

  it('is idempotent on the order', async () => {
    const { userId, accountId } = await provisionAccount();
    await prisma.tradingAccount.update({
      where: { id: accountId },
      data: { tradingStatus: 'BREACHED', balanceMinor: usd('48000.00').minor, dataStale: false },
    });
    const acc = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    const order = await prisma.order.create({
      data: {
        userId,
        quoteId: (await prisma.order.findUniqueOrThrow({ where: { id: acc.orderId } })).quoteId,
        planVersionId: acc.planVersionId,
        status: 'PAID',
        subtotalMinor: usd('589.00').minor,
        discountMinor: 0n, taxMinor: 0n, totalMinor: usd('589.00').minor,
        termsSnapshot: '{}', termsHash: 'reset',
        idempotencyKey: `reset-dup-${accountId}`,
      },
    });
    const { applyReset } = await import('@/server/services/reset-service');
    expect((await applyReset({ userId, tradingAccountId: accountId, orderId: order.id })).applied).toBe(true);
    expect((await applyReset({ userId, tradingAccountId: accountId, orderId: order.id })).applied).toBe(false);
    const after = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: accountId } });
    expect(after.resetCount).toBe(1);
  });

  it('refuses to reset an account that is still active', async () => {
    const { userId, accountId } = await provisionAccount();
    const { getResetOffer } = await import('@/server/services/reset-service');
    const offer = await getResetOffer(userId, accountId);
    expect(offer?.allowed).toBe(false);
    expect(offer?.reason).toMatch(/still active/);
  });

  it('prices the reset $10 below the DISCOUNTED account price', async () => {
    const { userId, accountId } = await provisionAccount();
    const { getResetOffer } = await import('@/server/services/reset-service');
    const offer = await getResetOffer(userId, accountId);
    // $50K is $449.25 with the coupon, so a reset is $439.25 — cheaper than
    // any way of buying the account again.
    expect(offer?.price.toDecimalString()).toBe('439.25');
    expect(offer?.newAccountPrice.toDecimalString()).toBe('449.25');
    expect(offer?.saving.toDecimalString()).toBe('10.00');
    expect(offer!.price.lt(offer!.newAccountPrice)).toBe(true);
  });
});

describe('withdrawing a plan from sale', () => {
  it('RETIRES its published version rather than deleting it', async () => {
    // Stand in for a plan that was published and has since been withdrawn from
    // the code catalog — the $75,000 account is the real case.
    const withdrawn = await prisma.planVersion.create({
      data: {
        planKey: 'SIM_WITHDRAWN_TEST',
        version: 1,
        status: 'PUBLISHED',
        label: '$75,000',
        startingBalanceMinor: usd('75000.00').minor,
        listPriceMinor: usd('799.00').minor,
        ceilingMinis: 5,
        ceilingMicros: 50,
        drawdownAllowanceMinor: usd('2500.00').minor,
        dailyLossLimitMinor: usd('900.00').minor,
        retainedBufferMinor: usd('2500.00').minor,
        dailyCashCapMinor: usd('2000.00').minor,
        trailingStopOffsetMinor: usd('100.00').minor,
        requirementStatuses: '{}',
        launchBlockers: '[]',
        sellableInProduction: true,
        publishedAt: new Date(),
      },
    });

    const { retireWithdrawnPlans } = await import('@/server/services/catalog-service');
    const retired = await retireWithdrawnPlans();
    expect(retired).toBeGreaterThanOrEqual(1);

    // The row must still exist, with its terms byte-for-byte intact, so an
    // order pointing at it still resolves to what was actually sold.
    const after = await prisma.planVersion.findUnique({ where: { id: withdrawn.id } });
    expect(after).not.toBeNull();
    expect(after!.status).toBe('RETIRED');
    expect(after!.sellableInProduction).toBe(false);
    expect(after!.listPriceMinor).toBe(usd('799.00').minor);
    expect(after!.retainedBufferMinor).toBe(usd('2500.00').minor);
  });

  it('leaves the plans still in the catalog published', async () => {
    const live = await prisma.planVersion.findMany({ where: { status: 'PUBLISHED' } });
    expect(live.length).toBeGreaterThan(0);
    expect(live.map((p) => p.planKey)).not.toContain('SIM_75K');
  });
});

describe('ledger integrity across the whole suite', () => {
  it('every ledger balances to zero', async () => {
    const results = await verifyLedgersBalance();
    for (const ledger of results) {
      expect(
        ledger.balanced,
        `${ledger.ledger} is out of balance by ${ledger.net.toDecimalString()}`,
      ).toBe(true);
    }
  });
});
