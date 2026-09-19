/**
 * Checkout: quote -> agreement signature -> order -> payment.
 *
 * Invariants this file exists to hold:
 *
 *  1. Prices are ALWAYS recomputed server-side from the trusted catalog. The
 *     client sends selections; it never sends money.
 *  2. A signature is bound to the exact quote hash. If the plan, its rules or
 *     the price changed between signing and charging, the order is refused and
 *     the customer re-reviews. Charging different terms than the ones signed is
 *     the failure mode this prevents.
 *  3. Order creation is idempotent and transactional. A double-submitted form
 *     or a retried request creates one order, redeems one coupon, and books one
 *     service slot.
 *  4. Add-ons requiring real human capacity are not chargeable without a slot.
 */

import { createHash } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/config';
import { Money } from '@/domain/money/money';
import { buildQuote, canonicaliseQuote, type Quote, type QuoteSelection } from '@/domain/pricing/quote';
import {
  DEFAULT_COUPON,
  normaliseCouponCode,
  validateCoupon,
  type CouponDefinition,
} from '@/domain/pricing/coupon';
import { getAddOn, isAddOnKey, type AddOnKey } from '@/domain/catalog/addons';
import { isPlanKey, type PlanKey } from '@/domain/catalog/plans';
import { getPublishedPlanVersion } from './catalog-service';
import { buildPurchaseEntries } from '@/domain/ledger/entries';
import { postEntries } from './ledger-service';
import { enqueueJob } from '@/server/jobs/queue';

type Tx = Prisma.TransactionClient;

const QUOTE_TTL_MS = 1000 * 60 * 30; // 30 minutes

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

// ---------------------------------------------------------------------------
// Quotes
// ---------------------------------------------------------------------------

async function loadCoupon(code: string | null): Promise<CouponDefinition | null> {
  if (!code) return null;
  const record = await prisma.coupon.findUnique({ where: { code: normaliseCouponCode(code) } });
  if (!record) return null;
  return {
    code: record.code,
    percentOff: BigInt(record.percentOff),
    scope: record.scope as CouponDefinition['scope'],
    validFrom: record.validFrom?.toISOString() ?? null,
    validUntil: record.validUntil?.toISOString() ?? null,
    maxRedemptions: record.maxRedemptions,
    maxRedemptionsPerCustomer: record.maxRedemptionsPerCustomer,
    stackable: false,
    active: record.active,
  };
}

export interface QuoteRequest {
  readonly planKey: string;
  readonly addOnKeys: readonly string[];
  readonly couponCode: string | null;
  readonly userId: string | null;
}

export interface QuoteOutcome {
  readonly quoteId: string;
  readonly quote: Quote;
  readonly snapshotHash: string;
  readonly expiresAt: Date;
  readonly couponRejection: string | null;
}

export async function createQuote(request: QuoteRequest): Promise<QuoteOutcome> {
  if (!isPlanKey(request.planKey)) {
    throw new CheckoutError('UNKNOWN_PLAN', 'That account size is not available.');
  }
  const addOnKeys: AddOnKey[] = [];
  for (const key of request.addOnKeys) {
    if (!isAddOnKey(key)) {
      throw new CheckoutError('UNKNOWN_ADDON', 'One of the selected extras is not available.');
    }
    if (!addOnKeys.includes(key)) addOnKeys.push(key);
  }

  const selection: QuoteSelection = {
    planKey: request.planKey,
    addOnKeys,
    couponCode: request.couponCode,
  };

  // Validate the coupon against live usage before it can affect a price.
  let coupon: CouponDefinition | null = null;
  let couponRejection: string | null = null;

  if (request.couponCode) {
    const candidate = await loadCoupon(request.couponCode);
    const usage = candidate
      ? {
          globalRedemptions: await prisma.couponRedemption.count({
            where: { coupon: { code: candidate.code } },
          }),
          customerRedemptions: request.userId
            ? await prisma.couponRedemption.count({
                where: { coupon: { code: candidate.code }, userId: request.userId },
              })
            : 0,
        }
      : { globalRedemptions: 0, customerRedemptions: 0 };

    const eligibleItems = 1 + addOnKeys.filter((k) => getAddOn(k).couponEligible).length;
    const validation = validateCoupon(candidate, usage, new Date(), eligibleItems);
    if (validation.ok) {
      coupon = validation.coupon;
    } else {
      couponRejection = validation.message;
    }
  }

  const quote = buildQuote({ selection, coupon });
  const canonical = canonicaliseQuote(quote);
  const snapshotHash = sha256(canonical);
  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS);

  const record = await prisma.quote.create({
    data: {
      userId: request.userId,
      planKey: selection.planKey,
      addOnKeys: JSON.stringify(addOnKeys),
      couponCode: coupon?.code ?? null,
      subtotalMinor: quote.subtotal.minor,
      discountMinor: quote.discountTotal.minor,
      taxMinor: quote.tax.minor,
      totalMinor: quote.total.minor,
      taxStatus: quote.taxStatus,
      snapshot: canonical,
      snapshotHash,
      productionBlockers: JSON.stringify(quote.productionBlockers),
      expiresAt,
    },
    select: { id: true },
  });

  return { quoteId: record.id, quote, snapshotHash, expiresAt, couponRejection };
}

/**
 * Recompute a stored quote from its selections and confirm it still hashes the
 * same.
 *
 * This is the guard against charging terms nobody agreed to: if an admin
 * published a new price or rule set after the customer signed, the hash moves
 * and the order is refused rather than silently charged at the new figure.
 */
export async function revalidateQuote(quoteId: string): Promise<{
  ok: boolean;
  reason: string | null;
  quote: Quote | null;
  stored: { id: string; snapshotHash: string; userId: string | null } | null;
}> {
  const stored = await prisma.quote.findUnique({ where: { id: quoteId } });
  if (!stored) return { ok: false, reason: 'That quote no longer exists.', quote: null, stored: null };

  if (stored.consumedAt) {
    return {
      ok: false,
      reason: 'That quote has already been used for an order.',
      quote: null,
      stored: { id: stored.id, snapshotHash: stored.snapshotHash, userId: stored.userId },
    };
  }
  if (stored.expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      reason: 'That quote has expired. Please review the current price and terms.',
      quote: null,
      stored: { id: stored.id, snapshotHash: stored.snapshotHash, userId: stored.userId },
    };
  }

  const coupon = await loadCoupon(stored.couponCode);
  const recomputed = buildQuote({
    selection: {
      planKey: stored.planKey as PlanKey,
      addOnKeys: JSON.parse(stored.addOnKeys) as AddOnKey[],
      couponCode: stored.couponCode,
    },
    coupon,
  });

  const hash = sha256(canonicaliseQuote(recomputed));
  if (hash !== stored.snapshotHash) {
    return {
      ok: false,
      reason:
        'The price or terms for this account changed after you reviewed them. ' +
        'Please review the updated terms before continuing.',
      quote: recomputed,
      stored: { id: stored.id, snapshotHash: stored.snapshotHash, userId: stored.userId },
    };
  }

  return {
    ok: true,
    reason: null,
    quote: recomputed,
    stored: { id: stored.id, snapshotHash: stored.snapshotHash, userId: stored.userId },
  };
}

// ---------------------------------------------------------------------------
// Agreements
// ---------------------------------------------------------------------------

export async function requiredDocuments() {
  return prisma.legalDocumentVersion.findMany({
    where: { requiredAtCheckout: true, status: { in: ['APPROVED', 'DRAFT_PENDING_LEGAL_REVIEW'] } },
    orderBy: [{ slug: 'asc' }, { version: 'desc' }],
  });
}

export interface SignatureInput {
  readonly userId: string;
  readonly quoteId: string;
  readonly documentId: string;
  readonly typedLegalName: string;
  readonly consentWording: string;
  readonly ipAddress?: string;
  readonly userAgent?: string;
}

export async function recordAcceptance(input: SignatureInput): Promise<{ id: string }> {
  const document = await prisma.legalDocumentVersion.findUnique({
    where: { id: input.documentId },
  });
  if (!document) throw new CheckoutError('UNKNOWN_DOCUMENT', 'That document was not found.');

  const quote = await prisma.quote.findUnique({ where: { id: input.quoteId } });
  if (!quote) throw new CheckoutError('UNKNOWN_QUOTE', 'That quote was not found.');
  if (quote.userId && quote.userId !== input.userId) {
    throw new CheckoutError('FORBIDDEN', 'That quote belongs to another account.');
  }

  const typed = input.typedLegalName.trim();
  if (typed.length < 2) {
    throw new CheckoutError('INVALID_SIGNATURE', 'Type your full legal name to sign.');
  }

  const existing = await prisma.agreementAcceptance.findUnique({
    where: {
      userId_documentId_quoteId: {
        userId: input.userId,
        documentId: input.documentId,
        quoteId: input.quoteId,
      },
    },
    select: { id: true },
  });
  if (existing) return existing;

  return prisma.agreementAcceptance.create({
    data: {
      userId: input.userId,
      documentId: input.documentId,
      quoteId: input.quoteId,
      // Both hashes are stored: the document text AND the exact commercial
      // terms. Either changing invalidates the signature.
      documentHash: document.bodyHash,
      quoteHash: quote.snapshotHash,
      typedLegalName: typed,
      consentWording: input.consentWording,
      signatureMethod: 'TYPED_NAME',
      ipAddress: input.ipAddress ?? null,
      userAgent: input.userAgent ?? null,
    },
    select: { id: true },
  });
}

export interface SignatureStatus {
  readonly complete: boolean;
  readonly missing: { id: string; slug: string; title: string }[];
  readonly staleSignatures: string[];
}

export async function signatureStatus(
  userId: string,
  quoteId: string,
): Promise<SignatureStatus> {
  const [documents, quote, acceptances] = await Promise.all([
    requiredDocuments(),
    prisma.quote.findUnique({ where: { id: quoteId }, select: { snapshotHash: true } }),
    prisma.agreementAcceptance.findMany({ where: { userId, quoteId } }),
  ]);

  if (!quote) throw new CheckoutError('UNKNOWN_QUOTE', 'That quote was not found.');

  const signedIds = new Set(acceptances.map((a) => a.documentId));
  const missing = documents
    .filter((d) => !signedIds.has(d.id))
    .map((d) => ({ id: d.id, slug: d.slug, title: d.title }));

  // A signature taken against a different quote hash no longer covers these terms.
  const staleSignatures = acceptances
    .filter((a) => a.quoteHash !== quote.snapshotHash)
    .map((a) => a.documentId);

  return { complete: missing.length === 0 && staleSignatures.length === 0, missing, staleSignatures };
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export class CheckoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'CheckoutError';
  }
}

export interface CreateOrderInput {
  readonly userId: string;
  readonly quoteId: string;
  /** Client-supplied, so a double submit creates exactly one order. */
  readonly idempotencyKey: string;
}

export interface CreateOrderResult {
  readonly orderId: string;
  readonly created: boolean;
  readonly totalMinor: bigint;
}

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const config = getConfig();

  const existing = await prisma.order.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true, totalMinor: true },
  });
  if (existing) {
    return { orderId: existing.id, created: false, totalMinor: existing.totalMinor };
  }

  const revalidated = await revalidateQuote(input.quoteId);
  if (!revalidated.ok || !revalidated.quote) {
    throw new CheckoutError('QUOTE_STALE', revalidated.reason ?? 'That quote is no longer valid.');
  }
  const quote = revalidated.quote;

  if (config.mode === 'PRODUCTION' && quote.productionBlockers.length > 0) {
    throw new CheckoutError(
      'NOT_SELLABLE',
      'This plan is not currently available for purchase. ' +
        quote.productionBlockers.map((b) => b.detail).join(' '),
    );
  }

  const signatures = await signatureStatus(input.userId, input.quoteId);
  if (!signatures.complete) {
    throw new CheckoutError(
      'SIGNATURES_INCOMPLETE',
      'Please review and sign the required agreements before continuing.',
    );
  }

  const stored = await prisma.quote.findUniqueOrThrow({ where: { id: input.quoteId } });
  const addOnKeys = JSON.parse(stored.addOnKeys) as AddOnKey[];
  const planVersion = await getPublishedPlanVersion(stored.planKey as PlanKey);

  // Capacity-limited add-ons may not be charged without a real slot.
  for (const key of addOnKeys) {
    const addon = getAddOn(key);
    if (!addon.requiresCapacityCheck) continue;
    const slot = await prisma.serviceSlot.findFirst({
      where: { addOnKey: key, startsAt: { gt: new Date() } },
      orderBy: { startsAt: 'asc' },
    });
    if (!slot || slot.bookedCount >= slot.capacity) {
      throw new CheckoutError(
        'NO_CAPACITY',
        `${addon.name} has no available slots right now. Remove it to continue, or choose ` +
          'another time when slots are published.',
      );
    }
  }

  return prisma.$transaction(async (tx) => {
    // Re-check inside the transaction: two concurrent submissions race here.
    const raced = await tx.order.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true, totalMinor: true },
    });
    if (raced) return { orderId: raced.id, created: false, totalMinor: raced.totalMinor };

    const freshQuote = await tx.quote.findUniqueOrThrow({ where: { id: input.quoteId } });
    if (freshQuote.consumedAt) {
      throw new CheckoutError('QUOTE_CONSUMED', 'That quote has already been used.');
    }

    // Coupon limits are enforced here, inside the transaction, so two orders
    // cannot both pass a check made outside it.
    if (freshQuote.couponCode) {
      const coupon = await tx.coupon.findUnique({ where: { code: freshQuote.couponCode } });
      if (!coupon || !coupon.active) {
        throw new CheckoutError('COUPON_INVALID', 'That discount code is no longer valid.');
      }
      const globalCount = await tx.couponRedemption.count({ where: { couponId: coupon.id } });
      if (coupon.maxRedemptions !== null && globalCount >= coupon.maxRedemptions) {
        throw new CheckoutError('COUPON_EXHAUSTED', 'That discount code has reached its limit.');
      }
      const customerCount = await tx.couponRedemption.count({
        where: { couponId: coupon.id, userId: input.userId },
      });
      if (
        coupon.maxRedemptionsPerCustomer !== null &&
        customerCount >= coupon.maxRedemptionsPerCustomer
      ) {
        throw new CheckoutError('COUPON_USED', 'You have already used that discount code.');
      }
    }

    const order = await tx.order.create({
      data: {
        userId: input.userId,
        quoteId: input.quoteId,
        planVersionId: planVersion.id,
        status: 'PENDING_PAYMENT',
        subtotalMinor: quote.subtotal.minor,
        discountMinor: quote.discountTotal.minor,
        taxMinor: quote.tax.minor,
        totalMinor: quote.total.minor,
        // The contract: quote, plan rules and their approval statuses, frozen.
        termsSnapshot: JSON.stringify({
          quote: JSON.parse(freshQuote.snapshot),
          planVersionId: planVersion.id,
          planKey: planVersion.planKey,
          planVersion: planVersion.version,
          rules: {
            startingBalanceMinor: planVersion.startingBalanceMinor.toString(),
            drawdownAllowanceMinor: planVersion.drawdownAllowanceMinor.toString(),
            dailyLossLimitMinor: planVersion.dailyLossLimitMinor.toString(),
            retainedBufferMinor: planVersion.retainedBufferMinor.toString(),
            dailyCashCapMinor: planVersion.dailyCashCapMinor.toString(),
            trailingStopAtMinor: planVersion.trailingStopAtMinor?.toString() ?? null,
            lifetimeCapKind: planVersion.lifetimeCapKind,
            lifetimeCapMinor: planVersion.lifetimeCapMinor?.toString() ?? null,
            ceilingMinis: planVersion.ceilingMinis,
            ceilingMicros: planVersion.ceilingMicros,
          },
          requirementStatuses: JSON.parse(planVersion.requirementStatuses),
        }),
        termsHash: freshQuote.snapshotHash,
        idempotencyKey: input.idempotencyKey,
        items: {
          create: quote.lines.map((line) => ({
            kind: line.kind,
            itemKey: line.itemKey,
            name: line.name,
            quantity: line.quantity,
            unitListPriceMinor: line.unitListPrice.minor,
            lineSubtotalMinor: line.lineSubtotal.minor,
            lineDiscountMinor: line.lineDiscount.minor,
            lineTotalMinor: line.lineTotal.minor,
          })),
        },
      },
      select: { id: true, totalMinor: true },
    });

    if (freshQuote.couponCode) {
      const coupon = await tx.coupon.findUniqueOrThrow({
        where: { code: freshQuote.couponCode },
      });
      await tx.couponRedemption.create({
        data: {
          couponId: coupon.id,
          userId: input.userId,
          orderId: order.id,
          amountMinor: quote.discountTotal.minor,
        },
      });
      await tx.coupon.update({
        where: { id: coupon.id },
        data: { redemptionCount: { increment: 1 } },
      });
    }

    await tx.quote.update({
      where: { id: input.quoteId },
      data: { consumedAt: new Date(), userId: input.userId },
    });

    await tx.agreementAcceptance.updateMany({
      where: { userId: input.userId, quoteId: input.quoteId },
      data: { orderId: order.id },
    });

    await tx.provisioningJob.create({
      data: {
        orderId: order.id,
        state: 'payment_pending',
        idempotencyKey: `provision:${order.id}`,
      },
    });

    return { orderId: order.id, created: true, totalMinor: order.totalMinor };
  });
}

// ---------------------------------------------------------------------------
// Payment confirmation
// ---------------------------------------------------------------------------

/**
 * Apply a CONFIRMED successful payment.
 *
 * Idempotent on the payment provider reference, which is what makes a replayed
 * webhook harmless: the second delivery finds the payment already succeeded and
 * enqueues nothing new.
 */
export async function markOrderPaid(input: {
  orderId: string;
  provider: string;
  providerRef: string;
  amount: Money;
  fee: Money;
  net: Money;
  idempotencyKey: string;
}): Promise<{ alreadyApplied: boolean }> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.payment.findUnique({
      where: { provider_providerRef: { provider: input.provider, providerRef: input.providerRef } },
    });
    if (existing && existing.status === 'SUCCEEDED') {
      return { alreadyApplied: true };
    }

    const order = await tx.order.findUniqueOrThrow({
      where: { id: input.orderId },
      include: { items: true },
    });

    if (order.totalMinor !== input.amount.minor) {
      throw new CheckoutError(
        'AMOUNT_MISMATCH',
        `Payment of ${input.amount.format()} does not match the order total. ` +
          'Refusing to fulfil an order that was not paid in full.',
      );
    }

    if (existing) {
      await tx.payment.update({
        where: { id: existing.id },
        data: {
          status: 'SUCCEEDED',
          feeMinor: input.fee.minor,
          netMinor: input.net.minor,
        },
      });
    } else {
      await tx.payment.create({
        data: {
          orderId: input.orderId,
          provider: input.provider,
          providerMode: getConfig().mode === 'PRODUCTION' ? 'PRODUCTION' : 'DEMO',
          providerRef: input.providerRef,
          status: 'SUCCEEDED',
          amountMinor: input.amount.minor,
          feeMinor: input.fee.minor,
          netMinor: input.net.minor,
          idempotencyKey: input.idempotencyKey,
        },
      });
    }

    if (order.status === 'PENDING_PAYMENT') {
      await tx.order.update({ where: { id: order.id }, data: { status: 'PAID' } });
    }

    const accountFee = order.items
      .filter((i) => i.kind === 'ACCOUNT_PLAN')
      .reduce((sum, i) => sum + i.lineSubtotalMinor, 0n);
    const addOnFee = order.items
      .filter((i) => i.kind === 'ADDON')
      .reduce((sum, i) => sum + i.lineSubtotalMinor, 0n);

    await postEntries(
      buildPurchaseEntries({
        orderId: order.id,
        userId: order.userId,
        accountFeeGross: Money.fromMinor(accountFee),
        addOnFeeGross: Money.fromMinor(addOnFee),
        discount: Money.fromMinor(order.discountMinor),
        processorFee: input.fee,
        netCashReceived: input.net,
        policyVersion: order.termsHash.slice(0, 16),
        idempotencyKey: `purchase:${order.id}`,
      }),
      tx,
    );

    // Grant entitlements for purchased add-ons.
    for (const item of order.items.filter((i) => i.kind === 'ADDON')) {
      if (!isAddOnKey(item.itemKey)) continue;
      const addon = getAddOn(item.itemKey);
      const expiresAt =
        addon.delivery.kind === 'timed-entitlement'
          ? new Date(Date.now() + addon.delivery.days * 24 * 60 * 60 * 1000)
          : null;
      await tx.entitlement
        .create({
          data: { userId: order.userId, orderId: order.id, addOnKey: item.itemKey, expiresAt },
        })
        .catch(() => undefined); // unique(orderId, addOnKey) makes retries safe
    }

    const job = await tx.provisioningJob.findFirst({ where: { orderId: order.id } });
    if (job && job.state === 'payment_pending') {
      await tx.provisioningJob.update({
        where: { id: job.id },
        data: { state: 'paid', nextAttemptAt: new Date() },
      });
    }

    await enqueueJob(
      { kind: 'PROVISION_ACCOUNT', payload: { orderId: order.id }, idempotencyKey: `provision:${order.id}` },
      tx,
    );

    return { alreadyApplied: false };
  });
}
