/**
 * Risk evaluation against authoritative provider data.
 *
 * Browser UI is not enforcement, and neither is polling on its own. What this
 * service does is apply authoritative observations to durable state, decide
 * whether a limit has been crossed, and REQUEST enforcement at the provider —
 * recording separately whether that request was actually confirmed. A flatten
 * that was requested but not confirmed is not a flat account, and this code
 * never claims otherwise.
 *
 * Event handling rules:
 *  - Every provider event is stored raw AND normalised before it is applied.
 *  - A sequence at or below the last applied one is a duplicate or an
 *    out-of-order arrival and is recorded but not applied.
 *  - Data older than the staleness window marks the account stale, which blocks
 *    payouts and new exposure and raises an alert.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import {
  applyEquityObservation,
  isTrailingBreached,
  remainingTrailingRoom,
  type TrailingParams,
} from '@/domain/risk/trailing';
import {
  dailyLossRemaining,
  dailyLossUsed,
  isDailyLossBreached,
  openSession,
  sessionTradingPnl,
  type DailyLossState,
} from '@/domain/risk/daily-loss';
import { DEFAULT_SESSION_CONFIG, nextMarketOpen, sessionDateFor } from '@/domain/risk/session';
import { computeExposure, ceilingToMicroEquivalents, type ProductSpec } from '@/domain/risk/exposure';
import { toRuleSnapshot } from './catalog-service';
import { getTradingProvider } from '@/server/providers/registry';
import type { AccountSnapshot } from '@/server/providers/trading/types';

/** Authoritative data older than this makes the account stale. */
export const STALENESS_THRESHOLD_MS = 90_000;

export interface RiskAssessment {
  readonly tradingAccountId: string;
  readonly sessionDate: string;
  readonly equity: Money;
  readonly highWater: Money;
  readonly threshold: Money;
  readonly remainingTrailingRoom: Money;
  readonly sessionPnl: Money;
  readonly dailyLossUsed: Money;
  readonly dailyLossRemaining: Money;
  readonly microEquivalents: number;
  readonly capMicroEquivalents: number;
  readonly breaches: readonly ('DAILY_LOSS' | 'TRAILING')[];
  readonly stale: boolean;
  readonly applied: boolean;
  readonly skipReason: string | null;
}

export async function loadProductSpecs(): Promise<Map<string, ProductSpec>> {
  const rows = await prisma.productRiskConfig.findMany();
  return new Map(
    rows.map((r) => [
      r.symbol,
      {
        symbol: r.symbol,
        nettingGroup: r.nettingGroup,
        microEquivalentsPerContract: r.microEquivalentsPerContract,
        approved: r.approved,
        description: r.description,
      },
    ]),
  );
}

/**
 * Apply one authoritative snapshot.
 *
 * Idempotent on the provider sequence number, so a replayed or duplicated event
 * changes nothing.
 */
export async function ingestSnapshot(
  tradingAccountId: string,
  snapshot: AccountSnapshot,
): Promise<RiskAssessment> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({
    where: { id: tradingAccountId },
    include: { planVersion: true },
  });
  const rules = toRuleSnapshot(account.planVersion);
  const sessionConfig = DEFAULT_SESSION_CONFIG.value;
  const observedAt = new Date(snapshot.sourceTimestamp);
  const sessionDate = sessionDateFor(observedAt, sessionConfig);

  // Record the event first, raw, whether or not we end up applying it.
  const duplicate = await prisma.providerEvent.findUnique({
    where: {
      provider_tradingAccountId_sequence: {
        provider: account.providerName,
        tradingAccountId,
        sequence: snapshot.sequence,
      },
    },
  });

  const outOfOrder = snapshot.sequence <= account.lastSequence;
  const skipReason = duplicate
    ? 'Duplicate provider sequence; already recorded.'
    : outOfOrder
      ? `Sequence ${snapshot.sequence} is not newer than the last applied ${account.lastSequence}.`
      : null;

  if (!duplicate) {
    await prisma.providerEvent.create({
      data: {
        tradingAccountId,
        provider: account.providerName,
        eventType: 'ACCOUNT_SNAPSHOT',
        sequence: snapshot.sequence,
        sourceTimestamp: observedAt,
        rawPayload: JSON.stringify({
          equity: snapshot.equity.toDecimalString(),
          balance: snapshot.balance.toDecimalString(),
          unrealised: snapshot.unrealised.toDecimalString(),
          commissions: snapshot.commissions.toDecimalString(),
          positions: snapshot.positions,
          workingOrders: snapshot.workingOrders,
          sequence: snapshot.sequence.toString(),
          sourceTimestamp: snapshot.sourceTimestamp,
        }),
        normalised: JSON.stringify({
          equityMinor: snapshot.equity.minor.toString(),
          sessionDate,
        }),
        applied: !skipReason,
        ignoredReason: skipReason,
      },
    });
  }

  if (skipReason) {
    return assessmentFrom(account, rules, sessionDate, Money.fromMinor(account.equityMinor), [], {
      applied: false,
      skipReason,
      microEquivalents: 0,
    });
  }

  const trailingParams: TrailingParams = {
    startingBalance: Money.fromMinor(account.startingBalanceMinor),
    drawdownAllowance: rules.drawdownAllowance,
    stopOffset: rules.trailingStopOffset,
  };

  // ---- session roll --------------------------------------------------------
  let dailyState: DailyLossState;
  const sessionRolled = account.sessionDate !== sessionDate;
  if (sessionRolled) {
    // A new session starts from the equity observed at the roll, and the
    // withdrawal tally resets with it.
    dailyState = openSession(sessionDate, snapshot.equity);
  } else {
    dailyState = {
      sessionDate,
      sessionStartEquity: Money.fromMinor(account.sessionStartEquityMinor),
      withdrawalDeductions: Money.fromMinor(account.sessionWithdrawalsMinor),
    };
  }

  // ---- trailing ------------------------------------------------------------
  const trailing = applyEquityObservation(
    trailingParams,
    {
      highWater: Money.fromMinor(account.highWaterMinor),
      threshold: Money.fromMinor(account.thresholdMinor),
      thresholdIsCapped: false,
    },
    snapshot.equity,
  );

  // ---- exposure ------------------------------------------------------------
  const products = await loadProductSpecs();
  const cap = ceilingToMicroEquivalents({
    minis: rules.ceilingMinis,
    micros: rules.ceilingMicros,
  });
  let microEquivalents = 0;
  try {
    microEquivalents = computeExposure(
      snapshot.positions,
      snapshot.workingOrders,
      products,
    ).totalWorstCase;
  } catch {
    // An unconfigured instrument appeared on the account. That is itself a
    // risk event, not a reason to crash the ingest loop.
    await prisma.riskEvent.create({
      data: {
        tradingAccountId,
        eventType: 'EXPOSURE_REJECTED',
        severity: 'CRITICAL',
        reason:
          'The account holds a position in an instrument with no approved risk configuration.',
        evidence: JSON.stringify({ positions: snapshot.positions }),
        sessionDate,
      },
    });
  }

  // ---- breaches ------------------------------------------------------------
  const breaches: ('DAILY_LOSS' | 'TRAILING')[] = [];
  if (isTrailingBreached(trailing, snapshot.equity)) breaches.push('TRAILING');
  if (isDailyLossBreached(dailyState, snapshot.equity, rules.dailyLossLimit)) {
    breaches.push('DAILY_LOSS');
  }

  const stale = Date.now() - observedAt.getTime() > STALENESS_THRESHOLD_MS;

  await prisma.$transaction(async (tx) => {
    await tx.tradingAccount.update({
      where: { id: tradingAccountId },
      data: {
        equityMinor: snapshot.equity.minor,
        balanceMinor: snapshot.balance.minor,
        highWaterMinor: trailing.highWater.minor,
        thresholdMinor: trailing.threshold.minor,
        sessionDate,
        sessionStartEquityMinor: dailyState.sessionStartEquity.minor,
        sessionWithdrawalsMinor: dailyState.withdrawalDeductions.minor,
        lastSequence: snapshot.sequence,
        lastSyncAt: new Date(),
        dataStale: stale,
      },
    });

    await tx.equityCheckpoint.create({
      data: {
        tradingAccountId,
        sessionDate,
        equityMinor: snapshot.equity.minor,
        balanceMinor: snapshot.balance.minor,
        unrealisedMinor: snapshot.unrealised.minor,
        commissionsMinor: snapshot.commissions.minor,
        highWaterMinor: trailing.highWater.minor,
        thresholdMinor: trailing.threshold.minor,
        sequence: snapshot.sequence,
        observedAt,
      },
    });

    await tx.positionSnapshot.create({
      data: {
        tradingAccountId,
        positions: JSON.stringify(snapshot.positions),
        workingOrders: JSON.stringify(snapshot.workingOrders),
        microEquivalents,
        capMicroEquivalents: cap,
        observedAt,
      },
    });

    if (sessionRolled && account.sessionDate) {
      await tx.riskEvent.create({
        data: {
          tradingAccountId,
          eventType: 'SESSION_ROLLED',
          severity: 'INFO',
          reason: `Trading session rolled from ${account.sessionDate} to ${sessionDate}. Daily loss allowance reset.`,
          evidence: JSON.stringify({ equityAtRoll: snapshot.equity.toDecimalString() }),
          sessionDate,
        },
      });
    }
  });

  // ---- enforcement ---------------------------------------------------------
  for (const breach of breaches) {
    await enforceBreach(tradingAccountId, breach, snapshot, trailing.threshold, sessionDate);
  }

  if (stale) {
    await markStale(tradingAccountId, observedAt);
  }

  return {
    tradingAccountId,
    sessionDate,
    equity: snapshot.equity,
    highWater: trailing.highWater,
    threshold: trailing.threshold,
    remainingTrailingRoom: remainingTrailingRoom(trailing, snapshot.equity),
    sessionPnl: sessionTradingPnl(dailyState, snapshot.equity),
    dailyLossUsed: dailyLossUsed(dailyState, snapshot.equity),
    dailyLossRemaining: dailyLossRemaining(dailyState, snapshot.equity, rules.dailyLossLimit),
    microEquivalents,
    capMicroEquivalents: cap,
    breaches,
    stale,
    applied: true,
    skipReason: null,
  };
}

function assessmentFrom(
  account: { id: string; equityMinor: bigint; highWaterMinor: bigint; thresholdMinor: bigint },
  rules: { dailyLossLimit: Money; ceilingMinis: number; ceilingMicros: number },
  sessionDate: string,
  equity: Money,
  breaches: ('DAILY_LOSS' | 'TRAILING')[],
  extra: { applied: boolean; skipReason: string | null; microEquivalents: number },
): RiskAssessment {
  return {
    tradingAccountId: account.id,
    sessionDate,
    equity,
    highWater: Money.fromMinor(account.highWaterMinor),
    threshold: Money.fromMinor(account.thresholdMinor),
    remainingTrailingRoom: Money.fromMinor(
      account.equityMinor - account.thresholdMinor > 0n
        ? account.equityMinor - account.thresholdMinor
        : 0n,
    ),
    sessionPnl: Money.zero(),
    dailyLossUsed: Money.zero(),
    dailyLossRemaining: rules.dailyLossLimit,
    microEquivalents: extra.microEquivalents,
    capMicroEquivalents: ceilingToMicroEquivalents({
      minis: rules.ceilingMinis,
      micros: rules.ceilingMicros,
    }),
    breaches,
    stale: false,
    applied: extra.applied,
    skipReason: extra.skipReason,
  };
}

/**
 * Act on a breach.
 *
 * Note the two-step: we REQUEST flatten/disable at the provider, then record
 * whether it was confirmed. An unconfirmed request leaves a CRITICAL event and
 * the account marked as needing attention, rather than a cheerful "positions
 * closed" that may not be true.
 */
async function enforceBreach(
  tradingAccountId: string,
  breach: 'DAILY_LOSS' | 'TRAILING',
  snapshot: AccountSnapshot,
  threshold: Money,
  sessionDate: string,
): Promise<void> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: tradingAccountId } });

  // A breach already recorded for this session should not re-fire every poll.
  const existing = await prisma.riskEvent.findFirst({
    where: {
      tradingAccountId,
      eventType: breach === 'TRAILING' ? 'TRAILING_BREACH' : 'DAILY_LOSS_BREACH',
      ...(breach === 'DAILY_LOSS' ? { sessionDate } : {}),
    },
  });
  if (existing) return;

  const provider = getTradingProvider();
  // A daily-loss lockout runs to the next Globex reopen, which is an hour
  // after the session roll that refreshes the allowance.
  const lockedOutUntil =
    breach === 'DAILY_LOSS' ? nextMarketOpen(new Date(), DEFAULT_SESSION_CONFIG.value) : null;

  const reason =
    breach === 'TRAILING'
      ? `Account equity ${snapshot.equity.format()} reached the maximum drawdown threshold ${threshold.format()}. Trading access is terminated for this account.`
      : `Session trading loss reached the daily limit. Positions are being flattened and trading is locked until the market reopens at ${lockedOutUntil!.toISOString()}.`;

  let flatten = { requested: true as const, confirmed: false, detail: 'not attempted', providerRef: null as string | null };
  let disable = { requested: true as const, confirmed: false, detail: 'not attempted', providerRef: null as string | null };

  try {
    flatten = await provider.flattenPositions(account.externalAccountId!, reason);
  } catch (error) {
    flatten = {
      requested: true,
      confirmed: false,
      detail: error instanceof Error ? error.message : String(error),
      providerRef: null,
    };
  }

  try {
    disable = await provider.disableTrading(account.externalAccountId!, reason);
  } catch (error) {
    disable = {
      requested: true,
      confirmed: false,
      detail: error instanceof Error ? error.message : String(error),
      providerRef: null,
    };
  }

  const fullyConfirmed = flatten.confirmed && disable.confirmed;

  await prisma.$transaction(async (tx) => {
    await tx.riskEvent.create({
      data: {
        tradingAccountId,
        eventType: breach === 'TRAILING' ? 'TRAILING_BREACH' : 'DAILY_LOSS_BREACH',
        severity: 'CRITICAL',
        reason,
        evidence: JSON.stringify({
          equity: snapshot.equity.toDecimalString(),
          threshold: threshold.toDecimalString(),
          sequence: snapshot.sequence.toString(),
          sourceTimestamp: snapshot.sourceTimestamp,
          flatten,
          disable,
        }),
        sessionDate,
        requestedAction: 'flattenPositions+disableTrading',
        actionConfirmed: fullyConfirmed,
        actionDetail: `${flatten.detail} | ${disable.detail}`,
      },
    });

    await tx.tradingAccount.update({
      where: { id: tradingAccountId },
      data: {
        tradingStatus: breach === 'TRAILING' ? 'BREACHED' : 'DAILY_PAUSED',
        statusReason: reason,
        ...(breach === 'TRAILING'
          ? { breachedAt: new Date(), breachReason: reason }
          : { lockedOutUntil }),
      },
    });
  });

  if (!fullyConfirmed) {
    await prisma.riskEvent.create({
      data: {
        tradingAccountId,
        eventType: 'TRADING_DISABLE_FAILED',
        severity: 'CRITICAL',
        reason:
          'We requested that the provider flatten positions and disable trading, but did not ' +
          'receive confirmation. External trading may still be possible. Operations must verify ' +
          'manually.',
        evidence: JSON.stringify({ flatten, disable }),
        sessionDate,
        requestedAction: 'flattenPositions+disableTrading',
        actionConfirmed: false,
      },
    });
  }
}

export async function markStale(tradingAccountId: string, lastObservedAt: Date): Promise<void> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: tradingAccountId } });
  if (account.dataStale) return;

  await prisma.$transaction(async (tx) => {
    await tx.tradingAccount.update({
      where: { id: tradingAccountId },
      data: { dataStale: true },
    });
    await tx.riskEvent.create({
      data: {
        tradingAccountId,
        eventType: 'DATA_STALE',
        severity: 'WARNING',
        reason:
          'Authoritative account data has not been received recently. Payouts and new exposure ' +
          'requests are blocked until the account reconciles.',
        evidence: JSON.stringify({ lastObservedAt: lastObservedAt.toISOString() }),
      },
    });
  });
}

/** Poll one account and apply whatever comes back. */
export async function syncAccount(tradingAccountId: string): Promise<RiskAssessment | null> {
  const account = await prisma.tradingAccount.findUniqueOrThrow({ where: { id: tradingAccountId } });
  if (!account.externalAccountId) return null;

  const provider = getTradingProvider();
  try {
    const snapshot = await provider.fetchAccountSnapshot(account.externalAccountId);
    return await ingestSnapshot(tradingAccountId, snapshot);
  } catch (error) {
    // Could not reach the provider: the account is stale, which blocks payouts.
    // Silently retrying without marking it would leave a payout path running on
    // data we cannot vouch for.
    await markStale(tradingAccountId, account.lastSyncAt ?? new Date(0));
    await prisma.tradingAccount.update({
      where: { id: tradingAccountId },
      data: { dataStale: true, statusReason: error instanceof Error ? error.message : String(error) },
    });
    return null;
  }
}
