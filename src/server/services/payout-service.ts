/**
 * Payout orchestration.
 *
 * Three systems must agree: our internal ledgers, the trading provider's
 * simulated balance, and a real payment rail. They do not share a transaction,
 * so this is a saga with explicit compensation — and with one deliberate
 * asymmetry:
 *
 *   We reverse a simulated deduction ONLY on a CONFIRMED non-payment.
 *
 * If the payment outcome is unknown, the request parks in
 * `needs_reconciliation` and waits for a provider lookup. Blindly reversing
 * would hand back simulated balance while the cash may already have landed in
 * the trader's bank account, letting the same profit be withdrawn twice.
 */

import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import {
  GROSS_WITHDRAWAL_INCREMENT,
  MINIMUM_GROSS_WITHDRAWAL,
  MIN_POST_WITHDRAWAL_ROOM,
} from '@/domain/catalog/plans';
import {
  computeCapacity,
  validateRequest,
  type PayoutCapacity,
  type PayoutContext,
  type RequestPreconditions,
} from '@/domain/payout/eligibility';
import { computeRemainingCapacity, reserveCapacity } from '@/domain/payout/reservation';
import {
  assertTransition,
  mayReverseSimulatedDeduction,
  type PayoutState,
} from '@/domain/payout/state-machine';
import { DEFAULT_SESSION_CONFIG, lockoutHasLifted, sessionDateFor } from '@/domain/risk/session';
import { buildObligationEntry, buildPayoutEntries } from '@/domain/ledger/entries';
import { effectiveRules, lifetimeCapForPayout, toRuleSnapshot } from './catalog-service';
import { checkPayoutProfile } from '@/domain/customer/profile';
import { checkLifetimeCapReached } from '@/domain/analytics/exposure';
import { postEntries, postEntry } from './ledger-service';
import { recordAudit } from './audit-service';
import { getTradingProvider } from '@/server/providers/registry';
import { enqueueJob } from '@/server/jobs/queue';
import { STALENESS_THRESHOLD_MS } from './risk-service';

export class PayoutError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PayoutError';
  }
}

async function recordTransition(
  payoutRequestId: string,
  from: PayoutState,
  to: PayoutState,
  reason: string,
  actor: string,
): Promise<void> {
  assertTransition(from, to);
  await prisma.$transaction([
    prisma.payoutRequest.update({ where: { id: payoutRequestId }, data: { state: to } }),
    prisma.payoutTransition.create({
      data: { payoutRequestId, fromState: from, toState: to, reason, actor },
    }),
  ]);
}

// ---------------------------------------------------------------------------
// Eligibility
// ---------------------------------------------------------------------------

export interface PayoutView {
  readonly capacity: PayoutCapacity;
  readonly context: PayoutContext;
  readonly preconditions: RequestPreconditions;
  readonly sessionDate: string;
  readonly lifetimeCapBlocked: boolean;
  readonly lifetimeCapMessage: string | null;
}

export async function getPayoutView(tradingAccountId: string): Promise<PayoutView> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: tradingAccountId },
    include: { planVersion: true },
  });
  const rules = effectiveRules(toRuleSnapshot(account.planVersion), account);
  const sessionDate = sessionDateFor(new Date(), DEFAULT_SESSION_CONFIG.value);

  // An unresolved lifetime cap blocks payouts rather than defaulting to
  // unlimited. Surfaced as a clear message, not an opaque error.
  let lifetimeCap: Money | null = null;
  let lifetimeCapBlocked = false;
  let lifetimeCapMessage: string | null = null;
  try {
    lifetimeCap = lifetimeCapForPayout(rules);
  } catch (error) {
    lifetimeCapBlocked = true;
    lifetimeCapMessage = error instanceof Error ? error.message : String(error);
  }

  const reservations = await prisma.payoutReservation.findMany({
    where: { tradingAccountId, status: { in: ['ACTIVE', 'CONSUMED'] } },
  });
  const remaining = computeRemainingCapacity(
    { dailyCashCap: rules.dailyCashCap, lifetimeCashCap: lifetimeCap },
    reservations.map((r) => ({
      id: r.id,
      payoutRequestId: r.payoutRequestId,
      sessionDate: r.sessionDate,
      cashAmount: Money.fromMinor(r.cashAmountMinor),
      status: r.status as 'ACTIVE' | 'CONSUMED' | 'RELEASED',
    })),
    sessionDate,
  );

  const positions = await prisma.positionSnapshot.findFirst({
    where: { tradingAccountId },
    orderBy: { observedAt: 'desc' },
  });
  const parsedPositions = positions
    ? (JSON.parse(positions.positions) as { signedQuantity: number }[])
    : [];
  const parsedOrders = positions
    ? (JSON.parse(positions.workingOrders) as unknown[])
    : [];

  const staleByClock =
    !account.lastSyncAt || Date.now() - account.lastSyncAt.getTime() > STALENESS_THRESHOLD_MS;

  const context: PayoutContext = {
    reconciledBalance: Money.fromMinor(account.balanceMinor),
    startingBalance: Money.fromMinor(account.startingBalanceMinor),
    retainedBuffer: rules.retainedBuffer,
    remainingDailyCash: remaining.remainingDailyCash,
    remainingLifetimeCash: remaining.remainingLifetimeCash,
    trailingThreshold: Money.fromMinor(account.thresholdMinor),
    minPostWithdrawalRoom: MIN_POST_WITHDRAWAL_ROOM.value,
    minimumGross: MINIMUM_GROSS_WITHDRAWAL.value,
    grossIncrement: GROSS_WITHDRAWAL_INCREMENT.value,
  };

  const preconditions: RequestPreconditions = {
    isFlat: parsedPositions.every((p) => p.signedQuantity === 0),
    hasConflictingOrders: parsedOrders.length > 0,
    accountIsActive:
      account.tradingStatus === 'ACTIVE' &&
      lockoutHasLifted(account.lockedOutUntil, new Date()),
    dataIsStale: account.dataStale || staleByClock,
  };

  return {
    capacity: computeCapacity(context),
    context,
    preconditions,
    sessionDate,
    lifetimeCapBlocked,
    lifetimeCapMessage,
  };
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export async function requestPayout(input: {
  userId: string;
  tradingAccountId: string;
  gross: Money;
  idempotencyKey: string;
}): Promise<{ payoutRequestId: string; created: boolean }> {
  const existing = await prisma.payoutRequest.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { payoutRequestId: existing.id, created: false };

  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: input.tradingAccountId },
    include: { planVersion: true },
  });
  if (account.userId !== input.userId) {
    throw new PayoutError('FORBIDDEN', 'That account belongs to another customer.');
  }

  // We must hold enough to pay a real person before promising them money.
  // Checked here rather than only in the UI: a payout reserved against capacity
  // we cannot actually disburse would hold that capacity away from a request we
  // could have honoured.
  const profile = await prisma.customerProfile.findUnique({
    where: { userId: input.userId },
    select: {
      phone: true,
      addressLine1: true,
      addressLine2: true,
      city: true,
      region: true,
      postalCode: true,
      countryCode: true,
    },
  });
  const profileCheck = checkPayoutProfile(
    profile ?? {
      phone: null,
      addressLine1: null,
      addressLine2: null,
      city: null,
      region: null,
      postalCode: null,
      countryCode: null,
    },
  );
  if (!profileCheck.ok) {
    throw new PayoutError(
      'PROFILE_INCOMPLETE',
      `We need a few details before we can pay you. ${profileCheck.messages.join(' ')}`,
    );
  }

  const view = await getPayoutView(input.tradingAccountId);
  if (view.lifetimeCapBlocked) {
    throw new PayoutError('LIFETIME_CAP_UNRESOLVED', view.lifetimeCapMessage!);
  }

  const validation = validateRequest(
    view.context,
    view.capacity,
    input.gross,
    view.preconditions,
  );
  if (!validation.ok) {
    throw new PayoutError(validation.reason ?? 'INVALID', validation.message ?? 'Request refused.');
  }

  const rules = effectiveRules(toRuleSnapshot(account.planVersion), account);
  const lifetimeCap = lifetimeCapForPayout(rules);

  return prisma.$transaction(async (tx) => {
    const raced = await tx.payoutRequest.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (raced) return { payoutRequestId: raced.id, created: false };

    // Re-read reservations INSIDE the transaction. This is what stops two
    // concurrent requests from both seeing the full daily cap.
    const held = await tx.payoutReservation.findMany({
      where: { tradingAccountId: input.tradingAccountId, status: { in: ['ACTIVE', 'CONSUMED'] } },
    });

    const outcome = reserveCapacity(
      { dailyCashCap: rules.dailyCashCap, lifetimeCashCap: lifetimeCap },
      held.map((r) => ({
        id: r.id,
        payoutRequestId: r.payoutRequestId,
        sessionDate: r.sessionDate,
        cashAmount: Money.fromMinor(r.cashAmountMinor),
        status: r.status as 'ACTIVE' | 'CONSUMED' | 'RELEASED',
      })),
      {
        id: randomUUID(),
        payoutRequestId: 'pending',
        sessionDate: view.sessionDate,
        cashAmount: validation.cash,
      },
    );
    if (!outcome.ok) {
      throw new PayoutError(outcome.reason, outcome.message);
    }

    const request = await tx.payoutRequest.create({
      data: {
        userId: input.userId,
        tradingAccountId: input.tradingAccountId,
        state: 'requested',
        grossMinor: validation.gross.minor,
        cashMinor: validation.cash.minor,
        sessionDate: view.sessionDate,
        balanceBeforeMinor: view.context.reconciledBalance.minor,
        balanceAfterMinor: validation.balanceAfter.minor,
        thresholdAtRequestMinor: view.context.trailingThreshold.minor,
        policySnapshot: JSON.stringify({
          startingBalance: view.context.startingBalance.toDecimalString(),
          retainedBuffer: view.context.retainedBuffer.toDecimalString(),
          dailyCashCap: rules.dailyCashCap.toDecimalString(),
          lifetimeCapKind: rules.lifetimeCapKind,
          lifetimeCap: lifetimeCap?.toDecimalString() ?? 'UNCAPPED_APPROVED',
          minimumGross: view.context.minimumGross.toDecimalString(),
          traderSharePercent: 50,
        }),
        policyVersion: `plan-${rules.planKey}-v${rules.version}`,
        idempotencyKey: input.idempotencyKey,
      },
    });

    await tx.payoutReservation.create({
      data: {
        payoutRequestId: request.id,
        tradingAccountId: input.tradingAccountId,
        sessionDate: view.sessionDate,
        cashAmountMinor: validation.cash.minor,
        status: 'ACTIVE',
      },
    });

    await tx.payoutTransition.create({
      data: {
        payoutRequestId: request.id,
        fromState: 'requested',
        toState: 'reserved',
        reason: 'Daily and lifetime cash capacity reserved at request time.',
        actor: input.userId,
      },
    });
    await tx.payoutRequest.update({ where: { id: request.id }, data: { state: 'reserved' } });

    await enqueueJob(
      {
        kind: 'SUBMIT_PAYOUT',
        payload: { payoutRequestId: request.id },
        idempotencyKey: `payout-validate:${request.id}`,
      },
      tx,
    );

    return { payoutRequestId: request.id, created: true };
  });
}

// ---------------------------------------------------------------------------
// Validation, approval, submission
// ---------------------------------------------------------------------------

/**
 * Re-check eligibility against FRESH data, then approve or route to review.
 *
 * Deliberately re-derives everything rather than trusting the figures captured
 * at request time: the balance may have moved, the account may have breached,
 * and the provider may have gone quiet since.
 */
export async function validateAndApprove(payoutRequestId: string): Promise<PayoutState> {
  const request = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: payoutRequestId } });
  if (request.state !== 'reserved') return request.state as PayoutState;

  await recordTransition(
    payoutRequestId,
    'reserved',
    'validating',
    'Re-checking balances and rules against fresh provider data.',
    'system',
  );

  const view = await getPayoutView(request.tradingAccountId);
  const gross = Money.fromMinor(request.grossMinor);

  // The request already holds its own reservation, so add it back before
  // testing capacity — otherwise the request would be measured against
  // capacity it itself consumed.
  const contextWithOwnReservation: PayoutContext = {
    ...view.context,
    remainingDailyCash: view.context.remainingDailyCash.plus(Money.fromMinor(request.cashMinor)),
    remainingLifetimeCash:
      view.context.remainingLifetimeCash === null
        ? null
        : view.context.remainingLifetimeCash.plus(Money.fromMinor(request.cashMinor)),
  };

  const capacity = computeCapacity(contextWithOwnReservation);
  const validation = validateRequest(
    contextWithOwnReservation,
    capacity,
    gross,
    view.preconditions,
  );

  if (!validation.ok) {
    // Routed to review with the specific reason, never silently dropped.
    await prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data: { reviewReason: validation.message },
    });
    await recordTransition(
      payoutRequestId,
      'validating',
      'needs_reconciliation',
      `Re-validation failed: ${validation.message}`,
      'system',
    );
    return 'needs_reconciliation';
  }

  await recordTransition(
    payoutRequestId,
    'validating',
    'approved',
    'Automatically approved: fully verified and within all limits.',
    'system',
  );

  await postEntry(
    buildObligationEntry({
      payoutRequestId,
      cash: Money.fromMinor(request.cashMinor),
      policyVersion: request.policyVersion,
      idempotencyKey: `payout:${payoutRequestId}`,
    }),
  );

  await enqueueJob({
    kind: 'SUBMIT_PAYOUT',
    payload: { payoutRequestId, stage: 'submit' },
    idempotencyKey: `payout-submit:${payoutRequestId}`,
  });

  return 'approved';
}

/**
 * Deduct the simulated balance, then pay real cash.
 *
 * Order matters. The simulated deduction happens first because it is the
 * reversible one: if the cash payment then fails in a CONFIRMED way, we can
 * compensate. Paying cash first and failing to deduct would leave a trader paid
 * twice for the same profit.
 */
export async function submitPayout(payoutRequestId: string): Promise<PayoutState> {
  const request = await prisma.payoutRequest.findUniqueOrThrow({
    where: { id: payoutRequestId },
    include: { tradingAccount: true },
  });
  if (request.state !== 'approved') return request.state as PayoutState;

  const gross = Money.fromMinor(request.grossMinor);
  const cash = Money.fromMinor(request.cashMinor);
  const provider = getTradingProvider();

  // ---- 1. simulated deduction ---------------------------------------------
  let deduction;
  try {
    deduction = await provider.adjustSimBalance(
      request.tradingAccount.externalAccountId!,
      gross.negated(),
      `Gross withdrawal for payout ${payoutRequestId}`,
      `payout-deduct:${payoutRequestId}`,
    );
  } catch (error) {
    await prisma.payoutRequest.update({
      where: { id: payoutRequestId },
      data: { reviewReason: error instanceof Error ? error.message : String(error) },
    });
    await recordTransition(
      payoutRequestId,
      'approved',
      'needs_reconciliation',
      'Simulated balance deduction failed at the provider.',
      'system',
    );
    return 'needs_reconciliation';
  }

  if (!deduction.confirmed) {
    await recordTransition(
      payoutRequestId,
      'approved',
      'needs_reconciliation',
      'Simulated balance deduction was requested but not confirmed.',
      'system',
    );
    return 'needs_reconciliation';
  }

  await recordTransition(
    payoutRequestId,
    'approved',
    'submitted',
    'Simulated balance deducted; cash payment submitted.',
    'system',
  );

  // The deduction reduces equity but is NOT a trading loss, so it is added to
  // the session's withdrawal tally and excluded from daily loss.
  await prisma.tradingAccount.update({
    where: { id: request.tradingAccountId },
    data: {
      balanceMinor: { decrement: gross.minor },
      equityMinor: { decrement: gross.minor },
      sessionWithdrawalsMinor: { increment: gross.minor },
    },
  });

  // ---- 2. real cash payment ------------------------------------------------
  // No verified payout rail is configured. Rather than pretending money moved,
  // the request parks for operator action with a truthful status.
  await prisma.payoutRequest.update({
    where: { id: payoutRequestId },
    data: {
      outcomeUnknown: false,
      reviewReason:
        'No verified cash payout rail is configured in this environment. The simulated ' +
        'deduction is applied and the cash payment is awaiting an operator with a ' +
        'configured payment rail.',
    },
  });

  return 'submitted';
}

/** Record a CONFIRMED successful cash payment. */
export async function markPayoutPaid(input: {
  payoutRequestId: string;
  paymentProvider: string;
  paymentRef: string;
  actor: string;
}): Promise<void> {
  const request = await prisma.payoutRequest.findUniqueOrThrow({
    where: { id: input.payoutRequestId },
    include: { tradingAccount: true, reservation: true },
  });
  if (request.state === 'paid') return; // idempotent

  await recordTransition(
    input.payoutRequestId,
    request.state as PayoutState,
    'paid',
    `Cash payment confirmed by ${input.paymentProvider} (${input.paymentRef}).`,
    input.actor,
  );

  await prisma.$transaction(async (tx) => {
    await tx.payoutRequest.update({
      where: { id: input.payoutRequestId },
      data: {
        paidAt: new Date(),
        paymentProvider: input.paymentProvider,
        paymentRef: input.paymentRef,
        outcomeUnknown: false,
      },
    });

    // The reservation becomes permanent consumption, not a release.
    if (request.reservation) {
      await tx.payoutReservation.update({
        where: { id: request.reservation.id },
        data: { status: 'CONSUMED' },
      });
    }

    await postEntries(
      buildPayoutEntries({
        payoutRequestId: input.payoutRequestId,
        tradingAccountId: request.tradingAccountId,
        userId: request.userId,
        gross: Money.fromMinor(request.grossMinor),
        cash: Money.fromMinor(request.cashMinor),
        policyVersion: request.policyVersion,
        idempotencyKey: `payout-paid:${input.payoutRequestId}`,
      }),
      tx,
    );
  });

  await recordAudit({
    actorId: null,
    actorLabel: input.actor,
    action: 'PAYOUT_PAID',
    entityType: 'PayoutRequest',
    entityId: input.payoutRequestId,
    after: { paymentRef: input.paymentRef },
  });

  await closeIfLifetimeCapReached(request.tradingAccountId, input.actor);
}

/**
 * Close an account that has now been paid its whole lifetime cap.
 *
 * Runs AFTER the payment is recorded, not inside that transaction. The payment
 * is the fact that matters and must not be rolled back because a follow-up
 * status change failed; if this does fail, the account is left open with no
 * capacity, which the payout gate already refuses — a safe direction to fail in.
 *
 * Idempotent: an account already CLOSED for this reason is left alone, so a
 * replayed payment confirmation does not write a second event.
 */
export async function closeIfLifetimeCapReached(
  tradingAccountId: string,
  actor: string,
): Promise<boolean> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: tradingAccountId },
    include: { planVersion: true },
  });
  if (!account) return false;
  if (account.tradingStatus === 'CLOSED' || account.tradingStatus === 'BREACHED') return false;

  const rules = effectiveRules(toRuleSnapshot(account.planVersion), account);
  let capMinor: bigint | null;
  try {
    capMinor = lifetimeCapForPayout(rules)?.minor ?? null;
  } catch {
    // An undecided cap cannot be reached. Payouts are already blocked on it.
    return false;
  }

  const reservations = await prisma.payoutReservation.findMany({
    where: { tradingAccountId, status: { in: ['ACTIVE', 'CONSUMED'] } },
    select: { cashAmountMinor: true, status: true },
  });
  const reservedMinor = reservations
    .filter((r) => r.status === 'ACTIVE')
    .reduce((total, r) => total + r.cashAmountMinor, 0n);
  const consumedMinor = reservations
    .filter((r) => r.status === 'CONSUMED')
    .reduce((total, r) => total + r.cashAmountMinor, 0n);

  const completion = checkLifetimeCapReached({
    lifetimeCapMinor: capMinor,
    reservedMinor,
    consumedMinor,
  });
  if (!completion.complete) return false;

  await prisma.tradingAccount.update({
    where: { id: tradingAccountId },
    data: { tradingStatus: 'CLOSED', statusReason: completion.message },
  });

  // Recorded as a risk event so it appears on the account timeline alongside
  // breaches and lockouts. Severity is INFO, not CRITICAL: the trader earned
  // everything the account could pay, which is the opposite of a breach.
  await prisma.riskEvent.create({
    data: {
      tradingAccountId,
      eventType: 'LIFETIME_CAP_REACHED',
      severity: 'INFO',
      reason: completion.message ?? 'Lifetime payout cap reached.',
      evidence: JSON.stringify({
        lifetimeCapMinor: capMinor?.toString() ?? null,
        consumedMinor: consumedMinor.toString(),
        reservedMinor: reservedMinor.toString(),
      }),
      requestedAction: 'CLOSE_ACCOUNT',
      actionConfirmed: true,
    },
  });

  await recordAudit({
    actorId: null,
    actorLabel: actor,
    action: 'ACCOUNT_COMPLETED_AT_CAP',
    entityType: 'TradingAccount',
    entityId: tradingAccountId,
    reason: 'Lifetime payout cap reached; account closed.',
    after: { tradingStatus: 'CLOSED' },
  });

  return true;
}

/**
 * Record a payment outcome we could not determine.
 *
 * This is NOT a failure. It parks the request for reconciliation, keeps the
 * capacity reserved, and leaves the simulated deduction in place.
 */
export async function markPayoutOutcomeUnknown(
  payoutRequestId: string,
  detail: string,
): Promise<void> {
  const request = await prisma.payoutRequest.findUniqueOrThrow({ where: { id: payoutRequestId } });
  if (request.state === 'needs_reconciliation') return;

  await recordTransition(
    payoutRequestId,
    request.state as PayoutState,
    'needs_reconciliation',
    `Payment outcome unknown: ${detail}`,
    'system',
  );
  await prisma.payoutRequest.update({
    where: { id: payoutRequestId },
    data: { outcomeUnknown: true, reconciliationNote: detail },
  });

  await enqueueJob({
    kind: 'RECONCILE_PAYOUT',
    payload: { payoutRequestId },
    idempotencyKey: `payout-reconcile:${payoutRequestId}`,
    runAfter: new Date(Date.now() + 60_000),
  });
}

/**
 * Resolve a reconciliation.
 *
 * `confirmedNotPaid` must come from an authoritative provider lookup. Only then
 * is the simulated deduction reversed and the reservation released.
 */
export async function resolveReconciliation(input: {
  payoutRequestId: string;
  confirmedNotPaid: boolean;
  paymentRef: string | null;
  actor: string;
  reason: string;
}): Promise<PayoutState> {
  const request = await prisma.payoutRequest.findUniqueOrThrow({
    where: { id: input.payoutRequestId },
    include: { tradingAccount: true, reservation: true },
  });

  if (!input.confirmedNotPaid) {
    await markPayoutPaid({
      payoutRequestId: input.payoutRequestId,
      paymentProvider: 'manual',
      paymentRef: input.paymentRef ?? 'manual-confirmation',
      actor: input.actor,
    });
    return 'paid';
  }

  if (!mayReverseSimulatedDeduction('failed', true)) {
    throw new PayoutError('CANNOT_REVERSE', 'Reversal is not permitted from this state.');
  }

  await recordTransition(
    input.payoutRequestId,
    request.state as PayoutState,
    'failed',
    `Provider confirmed no cash was sent: ${input.reason}`,
    input.actor,
  );

  const provider = getTradingProvider();
  const gross = Money.fromMinor(request.grossMinor);

  // Restore the simulated balance, now that non-payment is confirmed.
  await provider.adjustSimBalance(
    request.tradingAccount.externalAccountId!,
    gross,
    `Reversing deduction for confirmed unpaid payout ${input.payoutRequestId}`,
    `payout-reverse:${input.payoutRequestId}`,
  );

  await prisma.$transaction(async (tx) => {
    await tx.tradingAccount.update({
      where: { id: request.tradingAccountId },
      data: {
        balanceMinor: { increment: gross.minor },
        equityMinor: { increment: gross.minor },
        sessionWithdrawalsMinor: { decrement: gross.minor },
      },
    });
    if (request.reservation && request.reservation.status === 'ACTIVE') {
      await tx.payoutReservation.update({
        where: { id: request.reservation.id },
        data: { status: 'RELEASED' },
      });
    }
  });

  await recordAudit({
    actorId: null,
    actorLabel: input.actor,
    action: 'PAYOUT_REVERSED',
    entityType: 'PayoutRequest',
    entityId: input.payoutRequestId,
    reason: input.reason,
  });

  return 'failed';
}
