/**
 * Deterministic development seed.
 *
 * Creates one account in each state the system has to handle correctly, so the
 * dashboards, the risk engine and the payout engine can all be exercised
 * locally without waiting for real activity:
 *
 *   active · provisioning · daily paused · breached · payout eligible ·
 *   payout pending · payment outcome unknown · lifetime cap reached ·
 *   data stale · vendor failure
 *
 * The figures here are FIXTURES chosen to exercise boundaries. They are not
 * business statistics, and nothing in the admin console presents them as
 * performance of a real customer base.
 */

import { PrismaClient } from '../src/generated/prisma';
import { hashPassword } from '../src/server/auth/passwords';
import { LEGAL_DOCUMENT_DRAFTS, hashDocumentBody } from '../src/server/legal/documents';
import { PLANS, TRAILING_STOP_OFFSET } from '../src/domain/catalog/plans';
import { computeThreshold } from '../src/domain/risk/trailing';
import { DEFAULT_SESSION_CONFIG, nextMarketOpen, sessionDateFor } from '../src/domain/risk/session';
import { Money, usd } from '../src/domain/money/money';
import { DEFAULT_COUPON } from '../src/domain/pricing/coupon';

const prisma = new PrismaClient();

const DEMO_PASSWORD = 'demo-password-not-secret';
const SESSION_DATE = sessionDateFor(new Date(), DEFAULT_SESSION_CONFIG.value);

/** Instrument risk configuration. Anything absent cannot be traded. */
const PRODUCTS = [
  { symbol: 'ES', nettingGroup: 'EQUITY_INDEX_SP', microEquivalentsPerContract: 10, approved: true, description: 'E-mini S&P 500' },
  { symbol: 'MES', nettingGroup: 'EQUITY_INDEX_SP', microEquivalentsPerContract: 1, approved: true, description: 'Micro E-mini S&P 500' },
  { symbol: 'NQ', nettingGroup: 'EQUITY_INDEX_NASDAQ', microEquivalentsPerContract: 10, approved: true, description: 'E-mini Nasdaq-100' },
  { symbol: 'MNQ', nettingGroup: 'EQUITY_INDEX_NASDAQ', microEquivalentsPerContract: 1, approved: true, description: 'Micro E-mini Nasdaq-100' },
  {
    symbol: 'CL',
    nettingGroup: 'ENERGY_CRUDE',
    microEquivalentsPerContract: 10,
    approved: false,
    description:
      'Crude oil. NOT approved: dollar risk per contract differs materially from the equity ' +
      'index products and needs its own control before it can be enabled.',
  },
  {
    symbol: 'GC',
    nettingGroup: 'METALS_GOLD',
    microEquivalentsPerContract: 10,
    approved: false,
    description: 'Gold. NOT approved: product-specific risk controls pending.',
  },
];

async function seedUsers() {
  const password = await hashPassword(DEMO_PASSWORD);

  const people = [
    { id: 'usr_owner', email: 'owner@example.invalid', role: 'OWNER', legalName: 'Demo Owner', mfa: true },
    { id: 'usr_finance', email: 'finance@example.invalid', role: 'FINANCE', legalName: 'Demo Finance', mfa: true },
    { id: 'usr_support', email: 'support@example.invalid', role: 'SUPPORT', legalName: 'Demo Support', mfa: true },
    { id: 'usr_risk', email: 'risk@example.invalid', role: 'RISK', legalName: 'Demo Risk Ops', mfa: true },
  ];

  for (const person of people) {
    await prisma.user.upsert({
      where: { id: person.id },
      update: {},
      create: {
        id: person.id,
        email: person.email,
        emailNormalised: person.email.toLowerCase(),
        emailVerifiedAt: new Date(),
        passwordHash: password.hash,
        passwordSalt: password.salt,
        passwordParams: password.params,
        legalName: person.legalName,
        role: person.role,
        // Privileged roles require MFA before they can use admin areas.
        mfaEnabledAt: person.mfa ? new Date() : null,
        mfaSecret: person.mfa ? 'demo-mfa-secret-not-real' : null,
      },
    });
  }
  return password;
}

async function seedCatalogAndPolicies() {
  const coupon = DEFAULT_COUPON.value;
  await prisma.coupon.upsert({
    where: { code: coupon.code },
    update: {},
    create: {
      code: coupon.code,
      percentOff: Number(coupon.percentOff),
      scope: coupon.scope,
      maxRedemptions: coupon.maxRedemptions,
      maxRedemptionsPerCustomer: coupon.maxRedemptionsPerCustomer,
      active: coupon.active,
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
        // Every document is a draft. The launch gate checks this.
        status: 'DRAFT_PENDING_LEGAL_REVIEW',
        requiredAtCheckout: document.requiredAtCheckout,
      },
    });
  }

  for (const product of PRODUCTS) {
    await prisma.productRiskConfig.upsert({
      where: { symbol: product.symbol },
      update: {},
      create: product,
    });
  }

  // Real, finite capacity for the scheduled add-on.
  for (let day = 1; day <= 3; day += 1) {
    const startsAt = new Date(Date.now() + day * 24 * 60 * 60 * 1000);
    startsAt.setUTCHours(15, 0, 0, 0);
    await prisma.serviceSlot.upsert({
      where: { id: `slot_guided_${day}` },
      update: {},
      create: {
        id: `slot_guided_${day}`,
        addOnKey: 'GUIDED_SETUP',
        startsAt,
        endsAt: new Date(startsAt.getTime() + 20 * 60 * 1000),
        capacity: 2,
        bookedCount: 0,
      },
    });
  }

  await prisma.systemSetting.upsert({
    where: { key: 'NEW_SALES_ENABLED' },
    update: {},
    create: { key: 'NEW_SALES_ENABLED', value: 'true' },
  });
  await prisma.systemSetting.upsert({
    where: { key: 'PRODUCTION_LAUNCH_APPROVED' },
    update: {},
    create: { key: 'PRODUCTION_LAUNCH_APPROVED', value: 'false' },
  });
}

interface ScenarioSpec {
  readonly id: string;
  readonly email: string;
  readonly name: string;
  readonly planKey: string;
  readonly description: string;
  /** Current simulated equity/balance. */
  readonly equity: string;
  /** Highest observed equity. Drives the trailing threshold. */
  readonly highWater: string;
  readonly tradingStatus: string;
  readonly provisioningState: string;
  readonly statusReason?: string;
  readonly dataStale?: boolean;
  readonly lastSyncMinutesAgo?: number;
  readonly sessionStartEquity?: string;
  readonly sessionWithdrawals?: string;
  readonly payout?: {
    state: string;
    gross: string;
    outcomeUnknown?: boolean;
    reservationStatus?: string;
    note?: string;
  };
  /** Prior CONSUMED reservations, to model a cap that is already spent. */
  readonly priorConsumedCash?: string[];
}

const SCENARIOS: ScenarioSpec[] = [
  {
    id: 'active',
    email: 'trader.active@example.invalid',
    name: 'Ada Active',
    planKey: 'SIM_50K',
    description: 'Healthy active account, in profit but below the payout threshold.',
    equity: '51200.00',
    highWater: '51400.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '51000.00',
  },
  {
    id: 'eligible',
    email: 'trader.eligible@example.invalid',
    name: 'Eli Eligible',
    planKey: 'SIM_50K',
    description: 'Exactly at the worked example: $52,500 makes a $500 gross / $250 cash payout available.',
    equity: '52500.00',
    highWater: '52500.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '52100.00',
  },
  {
    id: 'justbelow',
    email: 'trader.justbelow@example.invalid',
    name: 'Bea Below',
    planKey: 'SIM_50K',
    description: 'One dollar short: $52,499 leaves $499 available, below the $500 minimum.',
    equity: '52499.00',
    highWater: '52499.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '52400.00',
  },
  {
    id: 'provisioning',
    email: 'trader.provisioning@example.invalid',
    name: 'Pat Pending',
    planKey: 'SIM_25K',
    description: 'Paid and queued for setup. No external account exists yet.',
    equity: '25000.00',
    highWater: '25000.00',
    tradingStatus: 'PENDING',
    provisioningState: 'provisioning',
    dataStale: true,
  },
  {
    id: 'vendorfail',
    email: 'trader.vendorfail@example.invalid',
    name: 'Vic Vendor',
    planKey: 'SIM_25K',
    description:
      'Payment succeeded but the provider could not create the account. Held for review, ' +
      'shown truthfully to the customer as not yet created.',
    equity: '25000.00',
    highWater: '25000.00',
    tradingStatus: 'PENDING',
    provisioningState: 'manual_review',
    statusReason: 'Provider returned a permanent error creating the simulated account.',
    dataStale: true,
  },
  {
    id: 'dailypaused',
    email: 'trader.dailypaused@example.invalid',
    name: 'Dana Daily',
    planKey: 'SIM_50K',
    description: 'Hit the daily loss limit. Flattened and locked out until the Globex reopen.',
    equity: '49405.00',
    highWater: '50200.00',
    tradingStatus: 'DAILY_PAUSED',
    provisioningState: 'active',
    statusReason:
      'Session trading loss reached the daily limit of $595.00. Trading is locked until the ' +
      'market reopens at 18:00 ET.',
    sessionStartEquity: '50000.00',
  },
  {
    id: 'breached',
    email: 'trader.breached@example.invalid',
    name: 'Bran Breached',
    planKey: 'SIM_50K',
    description: 'Equity fell to the trailing threshold. Trading access terminated.',
    equity: '49700.00',
    highWater: '51500.00',
    tradingStatus: 'BREACHED',
    provisioningState: 'active',
    statusReason:
      'Account equity reached the maximum drawdown threshold of $49,700.00. Trading access is ' +
      'terminated. A reset is available.',
    sessionStartEquity: '51000.00',
  },
  {
    id: 'payoutpending',
    email: 'trader.payoutpending@example.invalid',
    name: 'Pia Pending',
    planKey: 'SIM_50K',
    description: 'A $1,000 gross payout is approved and awaiting submission.',
    equity: '54000.00',
    highWater: '54000.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '53800.00',
    payout: { state: 'approved', gross: '1000.00' },
  },
  {
    id: 'unknownoutcome',
    email: 'trader.unknown@example.invalid',
    name: 'Uma Unknown',
    planKey: 'SIM_50K',
    description:
      'Payment outcome unknown. The simulated deduction is applied and capacity stays ' +
      'reserved; the balance is NOT restored until the provider confirms non-payment.',
    equity: '53000.00',
    highWater: '54000.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '54000.00',
    sessionWithdrawals: '1000.00',
    payout: {
      state: 'needs_reconciliation',
      gross: '1000.00',
      outcomeUnknown: true,
      note: 'Payment provider timed out. Awaiting an authoritative lookup before any retry or reversal.',
    },
  },
  {
    id: 'lifetimecap',
    email: 'trader.lifetimecap@example.invalid',
    name: 'Cass Capped',
    planKey: 'SIM_50K',
    description:
      'Has already received $3,000 cash. If a $3,000 lifetime cap were approved for this plan, ' +
      'no further capacity would remain.',
    equity: '56000.00',
    highWater: '56000.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    sessionStartEquity: '55800.00',
    priorConsumedCash: ['1500.00', '1500.00'],
  },
  {
    id: 'stale',
    email: 'trader.stale@example.invalid',
    name: 'Stan Stale',
    planKey: 'SIM_100K',
    description:
      'No authoritative data for over an hour. Payouts and new exposure are blocked and an ' +
      'alert is raised.',
    equity: '103000.00',
    highWater: '103500.00',
    tradingStatus: 'ACTIVE',
    provisioningState: 'active',
    dataStale: true,
    lastSyncMinutesAgo: 75,
    sessionStartEquity: '103000.00',
  },
];

async function seedScenario(spec: ScenarioSpec, password: Awaited<ReturnType<typeof hashPassword>>) {
  const plan = PLANS.find((p) => p.key === spec.planKey)!;
  const planVersion = await prisma.planVersion.findFirstOrThrow({
    where: { planKey: spec.planKey, status: 'PUBLISHED' },
  });

  const userId = `usr_${spec.id}`;
  await prisma.user.upsert({
    where: { id: userId },
    update: {},
    create: {
      id: userId,
      email: spec.email,
      emailNormalised: spec.email.toLowerCase(),
      emailVerifiedAt: new Date(),
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordParams: password.params,
      legalName: spec.name,
      role: 'TRADER',
    },
  });

  await prisma.customerVerification.upsert({
    where: { userId },
    update: {},
    create: {
      userId,
      // No identity provider is configured, so this is NOT_CONFIGURED rather
      // than a fabricated "VERIFIED".
      status: 'NOT_CONFIGURED',
      notes: 'No identity verification provider is configured in this environment.',
    },
  });

  const quoteId = `qte_${spec.id}`;
  const orderId = `ord_${spec.id}`;
  const listPrice = plan.listPrice.value;
  const discount = listPrice.mulRatio(25n, 100n, 'half-up');
  const total = listPrice.minus(discount);

  await prisma.quote.upsert({
    where: { id: quoteId },
    update: {},
    create: {
      id: quoteId,
      userId,
      planKey: spec.planKey,
      addOnKeys: '[]',
      couponCode: 'START25',
      subtotalMinor: listPrice.minor,
      discountMinor: discount.minor,
      taxMinor: 0n,
      totalMinor: total.minor,
      taxStatus: 'NOT_CONFIGURED',
      snapshot: JSON.stringify({ seeded: true, planKey: spec.planKey }),
      snapshotHash: `seedhash_${spec.id}`,
      productionBlockers: '[]',
      expiresAt: new Date(Date.now() + 30 * 60 * 1000),
      consumedAt: new Date(),
    },
  });

  await prisma.order.upsert({
    where: { id: orderId },
    update: {},
    create: {
      id: orderId,
      userId,
      quoteId,
      planVersionId: planVersion.id,
      status: spec.provisioningState === 'active' ? 'FULFILLED' : 'PAID',
      subtotalMinor: listPrice.minor,
      discountMinor: discount.minor,
      taxMinor: 0n,
      totalMinor: total.minor,
      termsSnapshot: JSON.stringify({
        seeded: true,
        planKey: spec.planKey,
        planVersion: planVersion.version,
      }),
      termsHash: `seedhash_${spec.id}`,
      idempotencyKey: `seed-order:${spec.id}`,
      items: {
        create: [
          {
            kind: 'ACCOUNT_PLAN',
            itemKey: spec.planKey,
            name: `${plan.label} simulated account`,
            quantity: 1,
            unitListPriceMinor: listPrice.minor,
            lineSubtotalMinor: listPrice.minor,
            lineDiscountMinor: discount.minor,
            lineTotalMinor: total.minor,
          },
        ],
      },
    },
  });

  await prisma.payment.upsert({
    where: { id: `pay_${spec.id}` },
    update: {},
    create: {
      id: `pay_${spec.id}`,
      orderId,
      provider: 'mock-payments',
      providerMode: 'DEMO',
      providerRef: `mockpi_seed_${spec.id}`,
      status: 'SUCCEEDED',
      amountMinor: total.minor,
      feeMinor: usd('13.32').minor,
      netMinor: total.minus(usd('13.32')).minor,
      idempotencyKey: `seed-payment:${spec.id}`,
    },
  });

  await prisma.provisioningJob.upsert({
    where: { idempotencyKey: `provision:${orderId}` },
    update: {},
    create: {
      orderId,
      state: spec.provisioningState,
      attempts: spec.provisioningState === 'manual_review' ? 5 : 1,
      lastError:
        spec.provisioningState === 'manual_review'
          ? 'Provider returned a permanent error creating the simulated account.'
          : null,
      riskVerification:
        spec.provisioningState === 'active'
          ? JSON.stringify({ mock: true, verified: true, note: 'Mock read-back only.' })
          : null,
      idempotencyKey: `provision:${orderId}`,
    },
  });

  // Accounts that never got provisioned have no external account id.
  const hasExternalAccount = !['provisioning', 'manual_review'].includes(spec.provisioningState);

  const equity = usd(spec.equity);
  const highWater = usd(spec.highWater);
  const threshold = computeThreshold(
    {
      startingBalance: plan.startingBalance,
      drawdownAllowance: plan.drawdownAllowance.value,
      stopOffset: TRAILING_STOP_OFFSET.value,
    },
    highWater,
  );

  const accountId = `acc_${spec.id}`;
  await prisma.tradingAccount.upsert({
    where: { id: accountId },
    update: {},
    create: {
      id: accountId,
      userId,
      orderId,
      planVersionId: planVersion.id,
      externalAccountId: hasExternalAccount ? `MOCK-${spec.planKey}-${spec.id}` : null,
      providerName: 'mock-trading',
      providerMode: 'MOCK',
      provisioningState: spec.provisioningState,
      tradingStatus: spec.tradingStatus,
      statusReason: spec.statusReason ?? null,
      startingBalanceMinor: plan.startingBalance.minor,
      balanceMinor: equity.minor,
      equityMinor: equity.minor,
      highWaterMinor: highWater.minor,
      thresholdMinor: threshold.minor,
      sessionDate: SESSION_DATE,
      sessionStartEquityMinor: usd(spec.sessionStartEquity ?? spec.equity).minor,
      sessionWithdrawalsMinor: usd(spec.sessionWithdrawals ?? '0.00').minor,
      lastSyncAt: hasExternalAccount
        ? new Date(Date.now() - (spec.lastSyncMinutesAgo ?? 0) * 60_000)
        : null,
      dataStale: spec.dataStale ?? false,
      lastSequence: 10n,
      lockedOutUntil:
        spec.tradingStatus === 'DAILY_PAUSED'
          ? nextMarketOpen(new Date(), DEFAULT_SESSION_CONFIG.value)
          : null,
      breachedAt: spec.tradingStatus === 'BREACHED' ? new Date() : null,
      breachReason: spec.tradingStatus === 'BREACHED' ? spec.statusReason ?? null : null,
    },
  });

  // Seeded accounts skip runProvisioning, so credentials are issued here —
  // otherwise the demo has active accounts with no platform sign-in.
  if (hasExternalAccount) {
    const { issueCredential } = await import('../src/server/services/credential-service');
    await issueCredential(accountId);
  }

  if (hasExternalAccount) {
    await prisma.positionSnapshot.create({
      data: {
        tradingAccountId: accountId,
        positions: '[]',
        workingOrders: '[]',
        microEquivalents: 0,
        capMicroEquivalents: plan.positionCeiling.value.micros,
        observedAt: new Date(Date.now() - (spec.lastSyncMinutesAgo ?? 0) * 60_000),
      },
    });

    await prisma.equityCheckpoint.create({
      data: {
        tradingAccountId: accountId,
        sessionDate: SESSION_DATE,
        equityMinor: equity.minor,
        balanceMinor: equity.minor,
        unrealisedMinor: 0n,
        commissionsMinor: usd('12.40').minor,
        highWaterMinor: highWater.minor,
        thresholdMinor: threshold.minor,
        sequence: 10n,
        observedAt: new Date(Date.now() - (spec.lastSyncMinutesAgo ?? 0) * 60_000),
      },
    });
  }

  // Risk events with plain-language reasons, visible to trader and admin alike.
  if (spec.tradingStatus === 'BREACHED') {
    await prisma.riskEvent.create({
      data: {
        tradingAccountId: accountId,
        eventType: 'TRAILING_BREACH',
        severity: 'CRITICAL',
        reason: spec.statusReason!,
        evidence: JSON.stringify({
          equity: equity.toDecimalString(),
          highWater: highWater.toDecimalString(),
          threshold: threshold.toDecimalString(),
        }),
        sessionDate: SESSION_DATE,
        requestedAction: 'flattenPositions+disableTrading',
        actionConfirmed: true,
      },
    });
  }
  if (spec.tradingStatus === 'DAILY_PAUSED') {
    await prisma.riskEvent.create({
      data: {
        tradingAccountId: accountId,
        eventType: 'DAILY_LOSS_BREACH',
        severity: 'CRITICAL',
        reason: spec.statusReason!,
        evidence: JSON.stringify({
          sessionStartEquity: spec.sessionStartEquity,
          equity: equity.toDecimalString(),
          dailyLossLimit: plan.dailyLossLimit.value.toDecimalString(),
        }),
        sessionDate: SESSION_DATE,
        requestedAction: 'flattenPositions+disableTrading',
        actionConfirmed: true,
      },
    });
  }
  if (spec.dataStale && hasExternalAccount) {
    await prisma.riskEvent.create({
      data: {
        tradingAccountId: accountId,
        eventType: 'DATA_STALE',
        severity: 'WARNING',
        reason:
          'Authoritative account data has not been received recently. Payouts and new exposure ' +
          'requests are blocked until the account reconciles.',
        evidence: JSON.stringify({ lastSyncMinutesAgo: spec.lastSyncMinutesAgo ?? null }),
        sessionDate: SESSION_DATE,
      },
    });
  }

  // Prior consumed capacity, for the lifetime-cap scenario.
  for (const [index, cash] of (spec.priorConsumedCash ?? []).entries()) {
    const priorPayoutId = `pay_prior_${spec.id}_${index}`;
    await prisma.payoutRequest.upsert({
      where: { id: priorPayoutId },
      update: {},
      create: {
        id: priorPayoutId,
        userId,
        tradingAccountId: accountId,
        state: 'paid',
        grossMinor: usd(cash).timesInt(2).minor,
        cashMinor: usd(cash).minor,
        sessionDate: '2026-01-05',
        balanceBeforeMinor: equity.minor,
        balanceAfterMinor: equity.minor,
        thresholdAtRequestMinor: threshold.minor,
        policySnapshot: JSON.stringify({ seeded: true }),
        policyVersion: `plan-${spec.planKey}-v1`,
        idempotencyKey: `seed-prior-payout:${spec.id}:${index}`,
        paidAt: new Date('2026-01-05T18:00:00Z'),
      },
    });
    await prisma.payoutReservation.upsert({
      where: { payoutRequestId: priorPayoutId },
      update: {},
      create: {
        payoutRequestId: priorPayoutId,
        tradingAccountId: accountId,
        sessionDate: '2026-01-05',
        cashAmountMinor: usd(cash).minor,
        status: 'CONSUMED',
      },
    });
  }

  if (spec.payout) {
    const payoutId = `pay_req_${spec.id}`;
    const gross = usd(spec.payout.gross);
    const cash = gross.halfExact();

    await prisma.payoutRequest.upsert({
      where: { id: payoutId },
      update: {},
      create: {
        id: payoutId,
        userId,
        tradingAccountId: accountId,
        state: spec.payout.state,
        grossMinor: gross.minor,
        cashMinor: cash.minor,
        sessionDate: SESSION_DATE,
        balanceBeforeMinor: equity.plus(spec.payout.outcomeUnknown ? gross : Money.zero()).minor,
        balanceAfterMinor: equity.minor,
        thresholdAtRequestMinor: threshold.minor,
        policySnapshot: JSON.stringify({
          startingBalance: plan.startingBalance.toDecimalString(),
          retainedBuffer: plan.retainedBuffer.value.toDecimalString(),
          dailyCashCap: plan.dailyCashPayoutCap.value.toDecimalString(),
          lifetimeCapKind: 'UNRESOLVED',
          traderSharePercent: 50,
        }),
        policyVersion: `plan-${spec.planKey}-v1`,
        outcomeUnknown: spec.payout.outcomeUnknown ?? false,
        reconciliationNote: spec.payout.note ?? null,
        idempotencyKey: `seed-payout:${spec.id}`,
      },
    });

    await prisma.payoutReservation.upsert({
      where: { payoutRequestId: payoutId },
      update: {},
      create: {
        payoutRequestId: payoutId,
        tradingAccountId: accountId,
        sessionDate: SESSION_DATE,
        cashAmountMinor: cash.minor,
        status: spec.payout.reservationStatus ?? 'ACTIVE',
      },
    });

    await prisma.payoutTransition.create({
      data: {
        payoutRequestId: payoutId,
        fromState: 'requested',
        toState: spec.payout.state,
        reason: spec.payout.note ?? 'Seeded fixture.',
        actor: 'seed',
      },
    });
  }

  return spec;
}

async function main() {
  console.log('Seeding development data...\n');

  const password = await seedUsers();

  const { publishCatalogIfEmpty, publishCatalogRevisions } = await import(
    '../src/server/services/catalog-service'
  );
  const published = await publishCatalogIfEmpty();
  console.log(`Published ${published.plans} plan versions and ${published.addons} add-on versions.`);

  // Terms changed in code since the catalog was first published get a NEW
  // version. Without this, approving a cap or moving a risk figure in plans.ts
  // never reaches the database and the payout engine keeps reading the old one.
  const revisions = await publishCatalogRevisions();
  if (revisions.length > 0) {
    console.log(`Published ${revisions.length} plan revisions:`);
    for (const r of revisions) {
      console.log(`  ${r.planKey}: v${r.fromVersion} -> v${r.toVersion}`);
    }
  }

  await seedCatalogAndPolicies();
  console.log(`Seeded coupon, ${LEGAL_DOCUMENT_DRAFTS.length} legal drafts, ${PRODUCTS.length} instruments, 3 service slots.`);

  for (const scenario of SCENARIOS) {
    await seedScenario(scenario, password);
  }

  console.log(`\nSeeded ${SCENARIOS.length} trader scenarios:\n`);
  for (const scenario of SCENARIOS) {
    console.log(`  ${scenario.email.padEnd(42)} ${scenario.description}`);
  }

  console.log('\nAdmin accounts (all require MFA, which is pre-enrolled in demo):\n');
  console.log('  owner@example.invalid      OWNER');
  console.log('  finance@example.invalid    FINANCE');
  console.log('  support@example.invalid    SUPPORT');
  console.log('  risk@example.invalid       RISK');
  console.log(`\nPassword for every seeded account: ${DEMO_PASSWORD}`);
  console.log('\nThese are DEMO FIXTURES chosen to exercise boundaries.');
  console.log('They are not business statistics and must not be read as such.\n');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
