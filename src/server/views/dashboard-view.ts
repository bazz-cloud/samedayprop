/**
 * Trader dashboard view model.
 *
 * Assembles everything the dashboard shows in one server-side pass, from
 * authoritative stored state. Two things it is careful about:
 *
 *  1. It never presents the simulated balance as a cash wallet. Simulated and
 *     cash figures are separate fields with separate labels.
 *  2. It reports staleness and status honestly, with the plain-language reason
 *     and the supporting data, rather than showing a confident number computed
 *     from data we know is old.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import { serialiseMoney, type SerialisedMoney } from '@/server/money-mapper';
import { toRuleSnapshot } from '@/server/services/catalog-service';
import { getPayoutView } from '@/server/services/payout-service';
import { STALENESS_THRESHOLD_MS } from '@/server/services/risk-service';
import { ceilingToMicroEquivalents } from '@/domain/risk/exposure';
import {
  dailyLossRemaining,
  dailyLossUsed,
  sessionTradingPnl,
} from '@/domain/risk/daily-loss';
import { traderFacingStatus, type ProvisioningState } from '@/domain/provisioning/state-machine';
import { MINIMUM_GROSS_WITHDRAWAL } from '@/domain/catalog/plans';
import { lockoutHasLifted } from '@/domain/risk/session';

/**
 * Progress toward the first payout.
 *
 * The climb is measured from the STARTING balance to the point where the
 * minimum gross withdrawal first becomes available, which is starting + buffer
 * + minimum. Measuring from zero would put every account at 95% on day one and
 * tell the trader nothing.
 */
function firstWithdrawalProgress(
  balance: Money,
  startingBalance: Money,
  retainedBuffer: Money,
  minimumGross: Money,
): FirstWithdrawalProgress {
  const target = startingBalance.plus(retainedBuffer).plus(minimumGross);
  const climbed = balance.minus(startingBalance);
  const total = target.minus(startingBalance);
  const remaining = target.minus(balance);

  const percent =
    total.minor <= 0n
      ? 100
      : Math.max(0, Math.min(100, Number((climbed.minor * 100n) / total.minor)));

  return {
    targetBalance: serialiseMoney(target),
    remaining: serialiseMoney(remaining.isNegative() ? Money.zero() : remaining),
    percent,
    // The buffer is met once profit covers the buffer itself, which happens
    // before the minimum withdrawal is reachable.
    bufferMet: balance.gte(startingBalance.plus(retainedBuffer)),
    reached: balance.gte(target),
  };
}

export interface AccountSummary {
  readonly id: string;
  readonly label: string;
  readonly tradingStatus: string;
  readonly provisioningState: string;
}

export interface FirstWithdrawalProgress {
  /** Balance at which the first payout becomes available. */
  readonly targetBalance: SerialisedMoney;
  /** How much more profit is needed. Zero once reached. */
  readonly remaining: SerialisedMoney;
  /** 0-100. How far through the climb from starting balance to target. */
  readonly percent: number;
  readonly bufferMet: boolean;
  readonly reached: boolean;
}

export interface DashboardAccount {
  readonly id: string;
  readonly planLabel: string;
  readonly planKey: string;

  readonly tradingStatus: string;
  readonly statusReason: string | null;
  readonly provisioningStatus: { headline: string; detail: string };
  readonly isTradeable: boolean;
  readonly externalAccountId: string | null;

  readonly dataStale: boolean;
  readonly lastSyncAt: string | null;
  readonly lastSyncAgeSeconds: number | null;

  // Simulated figures. Never cash.
  readonly startingBalance: SerialisedMoney;
  readonly simulatedBalance: SerialisedMoney;
  readonly simulatedEquity: SerialisedMoney;
  readonly unrealised: SerialisedMoney;
  readonly commissions: SerialisedMoney;

  readonly sessionDate: string | null;
  readonly sessionPnl: SerialisedMoney;
  readonly dailyLossLimit: SerialisedMoney;
  readonly dailyLossUsed: SerialisedMoney;
  readonly dailyLossRemaining: SerialisedMoney;

  readonly highWater: SerialisedMoney;
  readonly trailingThreshold: SerialisedMoney;
  readonly trailingRoom: SerialisedMoney;
  readonly trailingStopsAt: SerialisedMoney;
  readonly drawdownAllowance: SerialisedMoney;

  readonly exposureMicroEquivalents: number;
  readonly exposureCap: number;
  readonly positions: { symbol: string; signedQuantity: number }[];

  readonly retainedBuffer: SerialisedMoney;
  readonly firstWithdrawal: FirstWithdrawalProgress;
  readonly lockedOutUntil: string | null;
  readonly isLockedOut: boolean;
  readonly resetCount: number;

  // Cash figures. Real money.
  readonly payoutEligible: boolean;
  readonly payoutBinding: string | null;
  readonly payoutExplanation: string;
  readonly maxGross: SerialisedMoney;
  readonly maxCash: SerialisedMoney;
  readonly remainingDailyCash: SerialisedMoney;
  readonly remainingLifetimeCash: SerialisedMoney | null;
  readonly lifetimeCapBlocked: boolean;
  readonly lifetimeCapMessage: string | null;
  readonly minimumGross: SerialisedMoney;

  readonly preconditions: {
    isFlat: boolean;
    hasConflictingOrders: boolean;
    accountIsActive: boolean;
    dataIsStale: boolean;
  };

  readonly riskEvents: {
    id: string;
    eventType: string;
    severity: string;
    reason: string;
    occurredAt: string;
    actionConfirmed: boolean | null;
  }[];

  readonly payouts: {
    id: string;
    state: string;
    gross: SerialisedMoney;
    cash: SerialisedMoney;
    sessionDate: string;
    createdAt: string;
    paidAt: string | null;
    note: string | null;
  }[];

  readonly entitlements: { addOnKey: string; expiresAt: string | null }[];
}

export async function listAccounts(userId: string): Promise<AccountSummary[]> {
  const accounts = await prisma.tradingAccount.findMany({
    where: { userId },
    include: { planVersion: { select: { label: true } } },
    orderBy: { createdAt: 'asc' },
  });
  return accounts.map((account) => ({
    id: account.id,
    label: account.planVersion.label,
    tradingStatus: account.tradingStatus,
    provisioningState: account.provisioningState,
  }));
}

export async function getDashboardAccount(
  userId: string,
  accountId: string,
): Promise<DashboardAccount | null> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: accountId },
    include: { planVersion: true },
  });
  // Object-level authorisation, checked here rather than trusting the caller.
  if (!account || account.userId !== userId) return null;

  const rules = toRuleSnapshot(account.planVersion);
  const view = await getPayoutView(account.id);

  const [checkpoint, positionSnapshot, riskEvents, payouts, entitlements] = await Promise.all([
    prisma.equityCheckpoint.findFirst({
      where: { tradingAccountId: account.id },
      orderBy: { observedAt: 'desc' },
    }),
    prisma.positionSnapshot.findFirst({
      where: { tradingAccountId: account.id },
      orderBy: { observedAt: 'desc' },
    }),
    prisma.riskEvent.findMany({
      where: { tradingAccountId: account.id },
      orderBy: { occurredAt: 'desc' },
      take: 20,
    }),
    prisma.payoutRequest.findMany({
      where: { tradingAccountId: account.id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
    prisma.entitlement.findMany({ where: { userId, revokedAt: null } }),
  ]);

  const equity = Money.fromMinor(account.equityMinor);
  const dailyState = {
    sessionDate: account.sessionDate ?? '',
    sessionStartEquity: Money.fromMinor(account.sessionStartEquityMinor),
    withdrawalDeductions: Money.fromMinor(account.sessionWithdrawalsMinor),
  };

  const threshold = Money.fromMinor(account.thresholdMinor);
  const room = equity.minus(threshold);

  const lastSyncAgeSeconds = account.lastSyncAt
    ? Math.floor((Date.now() - account.lastSyncAt.getTime()) / 1000)
    : null;

  return {
    id: account.id,
    planLabel: account.planVersion.label,
    planKey: account.planVersion.planKey,

    tradingStatus: account.tradingStatus,
    statusReason: account.statusReason,
    provisioningStatus: traderFacingStatus(account.provisioningState as ProvisioningState),
    isTradeable: account.tradingStatus === 'ACTIVE',
    externalAccountId: account.externalAccountId,

    dataStale:
      account.dataStale ||
      lastSyncAgeSeconds === null ||
      lastSyncAgeSeconds * 1000 > STALENESS_THRESHOLD_MS,
    lastSyncAt: account.lastSyncAt?.toISOString() ?? null,
    lastSyncAgeSeconds,

    startingBalance: serialiseMoney(Money.fromMinor(account.startingBalanceMinor)),
    simulatedBalance: serialiseMoney(Money.fromMinor(account.balanceMinor)),
    simulatedEquity: serialiseMoney(equity),
    unrealised: serialiseMoney(Money.fromMinor(checkpoint?.unrealisedMinor ?? 0n)),
    commissions: serialiseMoney(Money.fromMinor(checkpoint?.commissionsMinor ?? 0n)),

    sessionDate: account.sessionDate,
    sessionPnl: serialiseMoney(sessionTradingPnl(dailyState, equity)),
    dailyLossLimit: serialiseMoney(rules.dailyLossLimit),
    dailyLossUsed: serialiseMoney(dailyLossUsed(dailyState, equity)),
    dailyLossRemaining: serialiseMoney(dailyLossRemaining(dailyState, equity, rules.dailyLossLimit)),

    highWater: serialiseMoney(Money.fromMinor(account.highWaterMinor)),
    trailingThreshold: serialiseMoney(threshold),
    trailingRoom: serialiseMoney(room.isNegative() ? Money.zero() : room),
    trailingStopsAt: serialiseMoney(
      Money.fromMinor(account.startingBalanceMinor).plus(rules.trailingStopOffset),
    ),
    drawdownAllowance: serialiseMoney(rules.drawdownAllowance),

    exposureMicroEquivalents: positionSnapshot?.microEquivalents ?? 0,
    exposureCap: ceilingToMicroEquivalents({
      minis: rules.ceilingMinis,
      micros: rules.ceilingMicros,
    }),
    positions: positionSnapshot
      ? (JSON.parse(positionSnapshot.positions) as { symbol: string; signedQuantity: number }[])
      : [],

    retainedBuffer: serialiseMoney(rules.retainedBuffer),
    firstWithdrawal: firstWithdrawalProgress(
      Money.fromMinor(account.balanceMinor),
      Money.fromMinor(account.startingBalanceMinor),
      rules.retainedBuffer,
      MINIMUM_GROSS_WITHDRAWAL.value,
    ),
    lockedOutUntil: account.lockedOutUntil?.toISOString() ?? null,
    isLockedOut: !lockoutHasLifted(account.lockedOutUntil, new Date()),
    resetCount: account.resetCount,

    payoutEligible: view.capacity.eligible && !view.lifetimeCapBlocked,
    payoutBinding: view.capacity.binding,
    payoutExplanation: view.lifetimeCapBlocked
      ? (view.lifetimeCapMessage ?? '')
      : view.capacity.explanation,
    maxGross: serialiseMoney(view.capacity.maxGross),
    maxCash: serialiseMoney(view.capacity.maxCash),
    remainingDailyCash: serialiseMoney(view.context.remainingDailyCash),
    remainingLifetimeCash:
      view.context.remainingLifetimeCash === null
        ? null
        : serialiseMoney(view.context.remainingLifetimeCash),
    lifetimeCapBlocked: view.lifetimeCapBlocked,
    lifetimeCapMessage: view.lifetimeCapMessage,
    minimumGross: serialiseMoney(view.context.minimumGross),

    preconditions: view.preconditions,

    riskEvents: riskEvents.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      severity: event.severity,
      reason: event.reason,
      occurredAt: event.occurredAt.toISOString(),
      actionConfirmed: event.actionConfirmed,
    })),

    payouts: payouts.map((payout) => ({
      id: payout.id,
      state: payout.state,
      gross: serialiseMoney(Money.fromMinor(payout.grossMinor)),
      cash: serialiseMoney(Money.fromMinor(payout.cashMinor)),
      sessionDate: payout.sessionDate,
      createdAt: payout.createdAt.toISOString(),
      paidAt: payout.paidAt?.toISOString() ?? null,
      note: payout.reconciliationNote ?? payout.reviewReason ?? payout.rejectionReason,
    })),

    entitlements: entitlements.map((entitlement) => ({
      addOnKey: entitlement.addOnKey,
      expiresAt: entitlement.expiresAt?.toISOString() ?? null,
    })),
  };
}
