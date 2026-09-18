/**
 * Paid account resets.
 *
 * Restores a breached account to its starting state for $10 less than buying a
 * new one. What survives a reset matters more than what it restores:
 *
 *   - Consumed LIFETIME payout capacity survives. The cap is an obligation
 *     ceiling per account; letting the cheapest purchase in the catalog clear
 *     it would make it meaningless.
 *   - Payout history survives. A reset is not a way to erase a record.
 *   - The platform credential survives, so the trader keeps their sign-in.
 *
 * Everything is append-only: the reset is recorded with the before and after
 * state, and the simulated adjustment goes through the ledger like any other.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import { getPlan, TRAILING_STOP_OFFSET, type PlanKey } from '@/domain/catalog/plans';
import {
  checkResetEligibility,
  computeResetState,
  referencePriceForReset,
  resetPriceForKey,
} from '@/domain/catalog/resets';
import { buildSimulatedAdjustmentEntry } from '@/domain/ledger/entries';
import { postEntry } from './ledger-service';
import { recordAudit } from './audit-service';
import { getTradingProvider } from '@/server/providers/registry';
import { lockoutHasLifted } from '@/domain/risk/session';

export class ResetError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'ResetError';
  }
}

export interface ResetOffer {
  readonly tradingAccountId: string;
  readonly planKey: string;
  readonly planLabel: string;
  readonly price: Money;
  readonly newAccountPrice: Money;
  readonly saving: Money;
  readonly allowed: boolean;
  readonly reason: string | null;
  readonly resetCount: number;
}

/** What a reset would cost and whether it is currently available. */
export async function getResetOffer(
  userId: string,
  tradingAccountId: string,
): Promise<ResetOffer | null> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: tradingAccountId },
    include: { planVersion: true },
  });
  if (!account || account.userId !== userId) return null;

  const planKey = account.planVersion.planKey as PlanKey;
  const plan = getPlan(planKey);

  const inFlight = await prisma.payoutRequest.count({
    where: {
      tradingAccountId,
      state: { notIn: ['paid', 'canceled', 'rejected'] },
    },
  });
  const positions = await prisma.positionSnapshot.findFirst({
    where: { tradingAccountId },
    orderBy: { observedAt: 'desc' },
  });
  const parsed = positions
    ? (JSON.parse(positions.positions) as { signedQuantity: number }[])
    : [];

  const eligibility = checkResetEligibility({
    tradingStatus: account.tradingStatus,
    hasPayoutInFlight: inFlight > 0,
    dataIsStale: account.dataStale,
    isFlat: parsed.every((p) => p.signedQuantity === 0),
  });

  return {
    tradingAccountId,
    planKey,
    planLabel: plan.label,
    price: resetPriceForKey(planKey),
    newAccountPrice: referencePriceForReset(plan),
    saving: referencePriceForReset(plan).minus(resetPriceForKey(planKey)),
    allowed: eligibility.allowed,
    reason: eligibility.message,
    resetCount: account.resetCount,
  };
}

/**
 * Apply a paid reset.
 *
 * Idempotent on the order: replaying the same paid order restores nothing a
 * second time.
 */
export async function applyReset(input: {
  userId: string;
  tradingAccountId: string;
  orderId: string;
}): Promise<{ applied: boolean; detail: string }> {
  const idempotencyKey = `reset:${input.orderId}`;
  const existing = await prisma.accountReset.findUnique({ where: { idempotencyKey } });
  if (existing) return { applied: false, detail: 'This reset has already been applied.' };

  const account = await prisma.tradingAccount.findUnique({
    where: { id: input.tradingAccountId },
    include: { planVersion: true },
  });
  if (!account || account.userId !== input.userId) {
    throw new ResetError('FORBIDDEN', 'That account belongs to another customer.');
  }

  const offer = await getResetOffer(input.userId, input.tradingAccountId);
  if (!offer || !offer.allowed) {
    throw new ResetError('NOT_ELIGIBLE', offer?.reason ?? 'This account cannot be reset.');
  }

  const planKey = account.planVersion.planKey as PlanKey;
  const plan = getPlan(planKey);
  const restored = computeResetState(plan, TRAILING_STOP_OFFSET.value);

  const previousBalance = Money.fromMinor(account.balanceMinor);
  const delta = restored.restoredBalance.minus(previousBalance);

  // Tell the provider first: if the simulated balance cannot be moved there,
  // our records must not claim it was.
  const provider = getTradingProvider();
  if (account.externalAccountId && !delta.isZero()) {
    const result = await provider.adjustSimBalance(
      account.externalAccountId,
      delta,
      `Account reset for order ${input.orderId}`,
      `reset-adjust:${input.orderId}`,
    );
    if (!result.confirmed) {
      throw new ResetError(
        'PROVIDER_UNCONFIRMED',
        'The trading platform did not confirm the balance reset. Our team has been notified ' +
          'and no charge has been applied to your account state.',
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.accountReset.create({
      data: {
        tradingAccountId: input.tradingAccountId,
        orderId: input.orderId,
        previousStatus: account.tradingStatus,
        previousBalanceMinor: account.balanceMinor,
        previousThresholdMinor: account.thresholdMinor,
        previousHighWaterMinor: account.highWaterMinor,
        restoredBalanceMinor: restored.restoredBalance.minor,
        restoredThresholdMinor: restored.restoredThreshold.minor,
        priceMinor: offer.price.minor,
        reason: `Paid reset of a ${account.tradingStatus.toLowerCase()} account`,
        idempotencyKey,
      },
    });

    await tx.tradingAccount.update({
      where: { id: input.tradingAccountId },
      data: {
        balanceMinor: restored.restoredBalance.minor,
        equityMinor: restored.restoredBalance.minor,
        highWaterMinor: restored.restoredHighWater.minor,
        thresholdMinor: restored.restoredThreshold.minor,
        tradingStatus: 'ACTIVE',
        statusReason: null,
        breachedAt: null,
        breachReason: null,
        lockedOutUntil: null,
        sessionStartEquityMinor: restored.restoredBalance.minor,
        sessionWithdrawalsMinor: 0n,
        resetCount: { increment: 1 },
        lastResetAt: new Date(),
      },
    });

    await tx.riskEvent.create({
      data: {
        tradingAccountId: input.tradingAccountId,
        eventType: 'ACCOUNT_RESET',
        severity: 'INFO',
        reason:
          `Account reset to its starting balance of ${restored.restoredBalance.format()}. ` +
          'Payout history and any consumed lifetime payout capacity are unchanged.',
        evidence: JSON.stringify({
          previousBalance: previousBalance.toDecimalString(),
          previousStatus: account.tradingStatus,
          restoredBalance: restored.restoredBalance.toDecimalString(),
          restoredThreshold: restored.restoredThreshold.toDecimalString(),
          orderId: input.orderId,
        }),
      },
    });

    if (!delta.isZero()) {
      await postEntry(
        buildSimulatedAdjustmentEntry({
          tradingAccountId: input.tradingAccountId,
          amount: delta.abs(),
          increase: delta.isPositive(),
          reason: `Account reset to starting balance (order ${input.orderId})`,
          actor: input.userId,
          policyVersion: `plan-${planKey}-v${account.planVersion.version}`,
          idempotencyKey: `reset-sim:${input.orderId}`,
        }),
        tx,
      );
    }
  });

  await recordAudit({
    actorId: input.userId,
    actorLabel: input.userId,
    action: 'ACCOUNT_RESET',
    entityType: 'TradingAccount',
    entityId: input.tradingAccountId,
    reason: `Paid reset, order ${input.orderId}`,
    before: { status: account.tradingStatus, balance: previousBalance.toDecimalString() },
    after: { status: 'ACTIVE', balance: restored.restoredBalance.toDecimalString() },
  });

  return {
    applied: true,
    detail: `Account restored to ${restored.restoredBalance.format()}.`,
  };
}

/** Whether an account is currently blocked by a daily-loss lockout. */
export function accountIsLockedOut(account: { lockedOutUntil: Date | null }): boolean {
  return !lockoutHasLifted(account.lockedOutUntil, new Date());
}
