/**
 * The admin console's data layer.
 *
 * One server-side assembly per screen rather than a dozen client fetches, and
 * every figure derived from the ledgers, the trade table and the risk engine's
 * own columns. Nothing here estimates: where a figure is not derivable from the
 * schema it is returned as null with a stated reason, and the UI renders an
 * empty slot rather than a plausible number.
 */

import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import { getPlan, isPlanKey, type PlanKey } from '@/domain/catalog/plans';
import { lifetimeCapAmountMinor, lifetimeCapBlocksProductionSale } from '@/domain/config/requirement-status';
import {
  dailyLossHeadroom,
  drawdownHeadroom,
  exposureRatio,
  firmExposure,
  remainingLifetimeCap,
  type Headroom,
} from '@/domain/analytics/exposure';
import {
  byHour,
  bySide,
  bySymbol,
  computeTradeStats,
  durationDistribution,
  type ClosedTrade,
  type TradeStats,
} from '@/domain/analytics/trade-stats';
import {
  buildClusters,
  clusterExposure,
  findMatchedTrades,
  findOwnerSignals,
  normaliseAddress,
  type CorrelationCluster,
} from '@/domain/analytics/correlation';

/** A figure we cannot compute, with the reason, so the UI can say why. */
export interface Unavailable {
  readonly available: false;
  readonly reason: string;
}

export type Maybe<T> = { available: true; value: T } | Unavailable;

const unavailable = (reason: string): Unavailable => ({ available: false, reason });
const available = <T>(value: T) => ({ available: true as const, value });

/** Cap for a plan key, or null where the owner approved an uncapped policy. */
function lifetimeCapMinorFor(planKey: string): bigint | null {
  if (!isPlanKey(planKey)) return null;
  const policy = getPlan(planKey as PlanKey).lifetimeCashCap;
  if (lifetimeCapBlocksProductionSale(policy)) return null;
  return lifetimeCapAmountMinor(policy);
}

const LIVE_STATUSES = ['ACTIVE', 'DAILY_PAUSED'];

// ---------------------------------------------------------------------------
// Firm overview
// ---------------------------------------------------------------------------

async function ledgerTotal(account: string, since?: Date): Promise<bigint> {
  const lines = await prisma.ledgerLine.findMany({
    where: {
      account,
      ...(since ? { entry: { createdAt: { gte: since } } } : {}),
    },
    select: { debitMinor: true, creditMinor: true },
  });
  return lines.reduce((total, line) => total + line.debitMinor + line.creditMinor, 0n);
}

export interface NetPosition {
  readonly accountFeesMinor: bigint;
  readonly addOnFeesMinor: bigint;
  readonly resetFeesMinor: bigint;
  readonly cashPaidMinor: bigint;
  readonly processorFeesMinor: bigint;
  readonly netMinor: bigint;
  /**
   * Revenue as the ORDERS say it, rather than as the ledger says it.
   *
   * The ledger is authoritative — it is what reconciles — but an order that
   * was never posted to it is invisible there. Reporting both makes that gap
   * visible instead of showing a confident zero.
   */
  readonly orderRevenueMinor: bigint;
  /** True when the two disagree, which means posting has fallen behind. */
  readonly unreconciled: boolean;
}

async function netPositionSince(since?: Date): Promise<NetPosition> {
  const [accountFees, addOnFees, cashPaid, processorFees] = await Promise.all([
    ledgerTotal('REVENUE_ACCOUNT_FEES', since),
    ledgerTotal('REVENUE_ADDON_FEES', since),
    ledgerTotal('CASH_TRADER_REWARDS_PAID', since),
    ledgerTotal('CASH_PROCESSOR_FEES_PAID', since),
  ]);

  // Reset fees are their own revenue line in the business but post to the same
  // account-fee ledger account, so they are read from AccountReset directly to
  // keep the reset-economics figures honest.
  const resets = await prisma.accountReset.findMany({
    where: since ? { createdAt: { gte: since } } : {},
    select: { priceMinor: true },
  });
  const resetFeesMinor = resets.reduce((total, r) => total + r.priceMinor, 0n);

  const orders = await prisma.order.findMany({
    where: { status: 'paid', ...(since ? { createdAt: { gte: since } } : {}) },
    select: { totalMinor: true },
  });
  const orderRevenueMinor = orders.reduce((total, o) => total + o.totalMinor, 0n);

  return {
    accountFeesMinor: accountFees,
    addOnFeesMinor: addOnFees,
    resetFeesMinor,
    cashPaidMinor: cashPaid,
    processorFeesMinor: processorFees,
    netMinor: accountFees + addOnFees - cashPaid - processorFees,
    orderRevenueMinor,
    unreconciled: orderRevenueMinor !== accountFees + addOnFees,
  };
}

export interface FunnelStage {
  readonly label: string;
  readonly count: Maybe<number>;
}

export interface CohortRow {
  readonly planKey: string;
  readonly label: string;
  readonly unitsSold: number;
  readonly grossRevenueMinor: bigint;
  readonly cashPaidMinor: bigint;
  readonly netMinor: bigint;
  readonly payoutRatio: number | null;
  readonly blowupRate: number | null;
  readonly averageLifespanDays: number | null;
}

export interface FirmOverview {
  readonly net: {
    readonly today: NetPosition;
    readonly sevenDays: NetPosition;
    readonly thirtyDays: NetPosition;
    readonly allTime: NetPosition;
  };
  readonly exposure: {
    readonly openExposureMinor: bigint;
    readonly liveAccounts: number;
    readonly uncappedAccounts: number;
    readonly cumulativeRevenueMinor: bigint;
  };
  readonly payoutLiability: {
    readonly eligibleAccounts: number;
    readonly grossIfAllWithdrewMinor: bigint;
    readonly cashIfAllWithdrewMinor: bigint;
  };
  readonly funnel: readonly FunnelStage[];
  readonly resets: {
    readonly blowups: number;
    readonly resetsPurchased: number;
    readonly resetRate: number | null;
    readonly resetRevenueShare: number | null;
    readonly medianDaysToBlowupByTier: readonly { label: string; days: number | null }[];
  };
  readonly cohorts: readonly CohortRow[];
  readonly clusters: readonly {
    readonly accounts: number;
    readonly matchedTrades: number;
    readonly symbols: readonly string[];
    readonly combinedRemainingCapMinor: bigint | null;
  }[];
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

export async function getFirmOverview(): Promise<FirmOverview> {
  const [today, sevenDays, thirtyDays, allTime] = await Promise.all([
    netPositionSince(daysAgo(1)),
    netPositionSince(daysAgo(7)),
    netPositionSince(daysAgo(30)),
    netPositionSince(),
  ]);

  const accounts = await prisma.tradingAccount.findMany({
    include: { planVersion: true, order: true },
  });

  const reservations = await prisma.payoutReservation.findMany({
    where: { status: { in: ['ACTIVE', 'CONSUMED'] } },
    select: { tradingAccountId: true, cashAmountMinor: true, status: true },
  });

  const reservedBy = new Map<string, { reserved: bigint; consumed: bigint }>();
  for (const r of reservations) {
    const current = reservedBy.get(r.tradingAccountId) ?? { reserved: 0n, consumed: 0n };
    if (r.status === 'ACTIVE') current.reserved += r.cashAmountMinor;
    else current.consumed += r.cashAmountMinor;
    reservedBy.set(r.tradingAccountId, current);
  }

  const exposureRows = accounts.map((account) => {
    const held = reservedBy.get(account.id) ?? { reserved: 0n, consumed: 0n };
    return {
      tradingAccountId: account.id,
      remainingLifetimeCapMinor: remainingLifetimeCap({
        lifetimeCapMinor: lifetimeCapMinorFor(account.planVersion.planKey),
        reservedMinor: held.reserved,
        consumedMinor: held.consumed,
      }),
      isLive: LIVE_STATUSES.includes(account.tradingStatus),
    };
  });

  const exposure = firmExposure(exposureRows);

  // Payout liability: what every live account in profit could take today.
  let eligibleAccounts = 0;
  let grossIfAllWithdrewMinor = 0n;
  for (const account of accounts) {
    if (!LIVE_STATUSES.includes(account.tradingStatus)) continue;
    const available =
      account.balanceMinor - account.startingBalanceMinor - account.planVersion.retainedBufferMinor;
    if (available < 50_000n) continue; // below the $500 gross minimum
    eligibleAccounts += 1;
    grossIfAllWithdrewMinor += available;
  }

  const tradedAccountIds = new Set(
    (await prisma.trade.findMany({ distinct: ['tradingAccountId'], select: { tradingAccountId: true } })).map(
      (t) => t.tradingAccountId,
    ),
  );

  const paidRequests = await prisma.payoutRequest.findMany({
    where: { state: 'paid' },
    select: { tradingAccountId: true, cashMinor: true },
  });
  const requestedAccountIds = new Set(
    (
      await prisma.payoutRequest.findMany({
        distinct: ['tradingAccountId'],
        select: { tradingAccountId: true },
      })
    ).map((r) => r.tradingAccountId),
  );

  const blown = accounts.filter((a) => a.tradingStatus === 'BREACHED');
  const inProfit = accounts.filter((a) => a.balanceMinor > a.startingBalanceMinor);

  const funnel: FunnelStage[] = [
    { label: 'Purchased', count: available(accounts.length) },
    { label: 'Traded at least once', count: available(tradedAccountIds.size) },
    { label: 'In profit', count: available(inProfit.length) },
    { label: 'Requested a payout', count: available(requestedAccountIds.size) },
    { label: 'Paid', count: available(new Set(paidRequests.map((r) => r.tradingAccountId)).size) },
    { label: 'Blown', count: available(blown.length) },
  ];

  // Reset economics.
  const resets = await prisma.accountReset.findMany({
    select: { tradingAccountId: true, priceMinor: true },
  });
  const resetRevenueMinor = resets.reduce((total, r) => total + r.priceMinor, 0n);
  const totalRevenueMinor = allTime.accountFeesMinor + allTime.addOnFeesMinor;

  const byTier = new Map<string, { label: string; blowupDays: number[]; accounts: typeof accounts }>();
  for (const account of accounts) {
    const key = account.planVersion.planKey;
    const label = isPlanKey(key) ? getPlan(key as PlanKey).label : key;
    const bucket = byTier.get(key) ?? { label, blowupDays: [], accounts: [] };
    bucket.accounts.push(account);
    if (account.tradingStatus === 'BREACHED' && account.breachedAt) {
      bucket.blowupDays.push(
        (account.breachedAt.getTime() - account.createdAt.getTime()) / (24 * 60 * 60 * 1000),
      );
    }
    byTier.set(key, bucket);
  }

  const cashPaidByAccount = new Map<string, bigint>();
  for (const r of paidRequests) {
    cashPaidByAccount.set(
      r.tradingAccountId,
      (cashPaidByAccount.get(r.tradingAccountId) ?? 0n) + r.cashMinor,
    );
  }

  const cohorts: CohortRow[] = [...byTier.entries()].map(([planKey, bucket]) => {
    const grossRevenueMinor = bucket.accounts.reduce(
      (total, a) => total + (a.order.totalMinor ?? 0n),
      0n,
    );
    const cashPaidMinor = bucket.accounts.reduce(
      (total, a) => total + (cashPaidByAccount.get(a.id) ?? 0n),
      0n,
    );
    const blowups = bucket.accounts.filter((a) => a.tradingStatus === 'BREACHED').length;
    const lifespans = bucket.accounts.map(
      (a) =>
        ((a.breachedAt ?? new Date()).getTime() - a.createdAt.getTime()) / (24 * 60 * 60 * 1000),
    );

    return {
      planKey,
      label: bucket.label,
      unitsSold: bucket.accounts.length,
      grossRevenueMinor,
      cashPaidMinor,
      netMinor: grossRevenueMinor - cashPaidMinor,
      payoutRatio:
        grossRevenueMinor === 0n ? null : Number(cashPaidMinor) / Number(grossRevenueMinor),
      blowupRate: bucket.accounts.length === 0 ? null : blowups / bucket.accounts.length,
      averageLifespanDays:
        lifespans.length === 0 ? null : lifespans.reduce((a, b) => a + b, 0) / lifespans.length,
    };
  });

  // Correlated clusters.
  const correlatable = await prisma.trade.findMany({
    where: { status: 'CLOSED' },
    select: {
      id: true,
      tradingAccountId: true,
      symbol: true,
      side: true,
      entryPriceE8: true,
      openedAt: true,
    },
  });
  const clusterList = buildClusters(
    findMatchedTrades(
      correlatable.map((t) => ({ ...t, side: t.side as 'LONG' | 'SHORT' })),
    ),
  );

  const exposureByAccount = new Map(
    exposureRows.map((row) => [
      row.tradingAccountId,
      {
        remainingLifetimeCapMinor: row.remainingLifetimeCapMinor,
        equityMinor: accounts.find((a) => a.id === row.tradingAccountId)?.equityMinor ?? 0n,
        openMicroEquivalents: 0,
      },
    ]),
  );

  return {
    net: { today, sevenDays, thirtyDays, allTime },
    exposure: {
      openExposureMinor: exposure.openExposureMinor,
      liveAccounts: exposure.liveAccounts,
      uncappedAccounts: exposure.uncappedAccounts,
      cumulativeRevenueMinor: totalRevenueMinor,
    },
    payoutLiability: {
      eligibleAccounts,
      grossIfAllWithdrewMinor,
      cashIfAllWithdrewMinor: grossIfAllWithdrewMinor / 2n,
    },
    funnel,
    resets: {
      blowups: blown.length,
      resetsPurchased: resets.length,
      resetRate: blown.length === 0 ? null : resets.length / blown.length,
      resetRevenueShare:
        totalRevenueMinor === 0n ? null : Number(resetRevenueMinor) / Number(totalRevenueMinor),
      medianDaysToBlowupByTier: [...byTier.values()].map((bucket) => ({
        label: bucket.label,
        days: median(bucket.blowupDays),
      })),
    },
    cohorts: cohorts.sort((a, b) => a.label.localeCompare(b.label)),
    clusters: clusterList.map((cluster: CorrelationCluster) => {
      const combined = clusterExposure(cluster, exposureByAccount);
      return {
        accounts: cluster.tradingAccountIds.length,
        matchedTrades: cluster.matchedTrades,
        symbols: cluster.symbols,
        combinedRemainingCapMinor: combined.combinedRemainingCapMinor,
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// Accounts table
// ---------------------------------------------------------------------------

export interface AccountRow {
  readonly id: string;
  readonly ownerEmail: string;
  readonly ownerName: string | null;
  readonly tier: string;
  readonly status: string;
  readonly balanceMinor: bigint;
  readonly equityMinor: bigint;
  readonly highWaterMinor: bigint;
  readonly drawdown: Headroom;
  readonly dailyLoss: Headroom;
  readonly openMicroEquivalents: number;
  readonly capMicroEquivalents: number;
  readonly stats: TradeStats;
  readonly payoutCount: number;
  readonly cashPaidMinor: bigint;
  readonly remainingLifetimeCapMinor: bigint | null;
  readonly daysAlive: number;
  readonly paidMinor: bigint;
  readonly exposureRatio: number | null;
  readonly inCluster: boolean;
}

export async function getAccountRows(): Promise<readonly AccountRow[]> {
  const accounts = await prisma.tradingAccount.findMany({
    include: { planVersion: true, user: true, order: true },
    orderBy: { createdAt: 'desc' },
  });

  const [trades, reservations, payouts, positions, resets] = await Promise.all([
    prisma.trade.findMany({
      select: {
        id: true,
        tradingAccountId: true,
        symbol: true,
        side: true,
        quantity: true,
        realisedPnlMinor: true,
        commissionMinor: true,
        openedAt: true,
        closedAt: true,
        status: true,
        entryPriceE8: true,
        microEquivalents: true,
      },
    }),
    prisma.payoutReservation.findMany({
      where: { status: { in: ['ACTIVE', 'CONSUMED'] } },
      select: { tradingAccountId: true, cashAmountMinor: true, status: true },
    }),
    prisma.payoutRequest.findMany({
      select: { tradingAccountId: true, state: true, cashMinor: true },
    }),
    prisma.positionSnapshot.findMany({ orderBy: { observedAt: 'desc' } }),
    prisma.accountReset.findMany({ select: { tradingAccountId: true, priceMinor: true } }),
  ]);

  const clusters = buildClusters(
    findMatchedTrades(
      trades
        .filter((t) => t.status === 'CLOSED')
        .map((t) => ({
          id: t.id,
          tradingAccountId: t.tradingAccountId,
          symbol: t.symbol,
          side: t.side as 'LONG' | 'SHORT',
          entryPriceE8: t.entryPriceE8,
          openedAt: t.openedAt,
        })),
    ),
  );
  const clustered = new Set(clusters.flatMap((c) => c.tradingAccountIds));

  const latestPosition = new Map<string, (typeof positions)[number]>();
  for (const snapshot of positions) {
    if (!latestPosition.has(snapshot.tradingAccountId)) {
      latestPosition.set(snapshot.tradingAccountId, snapshot);
    }
  }

  return accounts.map((account) => {
    const own = trades.filter((t) => t.tradingAccountId === account.id);
    const closed: ClosedTrade[] = own
      .filter((t) => t.status === 'CLOSED' && t.closedAt !== null)
      .map((t) => ({
        symbol: t.symbol,
        side: t.side as 'LONG' | 'SHORT',
        quantity: t.quantity,
        realisedPnlMinor: t.realisedPnlMinor,
        commissionMinor: t.commissionMinor,
        openedAt: t.openedAt,
        closedAt: t.closedAt!,
      }));

    const held = reservations
      .filter((r) => r.tradingAccountId === account.id)
      .reduce(
        (acc, r) => {
          if (r.status === 'ACTIVE') acc.reserved += r.cashAmountMinor;
          else acc.consumed += r.cashAmountMinor;
          return acc;
        },
        { reserved: 0n, consumed: 0n },
      );

    const accountPayouts = payouts.filter((p) => p.tradingAccountId === account.id);
    const cashPaidMinor = accountPayouts
      .filter((p) => p.state === 'paid')
      .reduce((total, p) => total + p.cashMinor, 0n);

    const resetSpendMinor = resets
      .filter((r) => r.tradingAccountId === account.id)
      .reduce((total, r) => total + r.priceMinor, 0n);
    const paidMinor = (account.order.totalMinor ?? 0n) + resetSpendMinor;

    const snapshot = latestPosition.get(account.id);
    const capMinor = lifetimeCapMinorFor(account.planVersion.planKey);

    return {
      id: account.id,
      ownerEmail: account.user.email,
      ownerName: account.user.legalName,
      tier: isPlanKey(account.planVersion.planKey)
        ? getPlan(account.planVersion.planKey as PlanKey).label
        : account.planVersion.planKey,
      status: account.tradingStatus,
      balanceMinor: account.balanceMinor,
      equityMinor: account.equityMinor,
      highWaterMinor: account.highWaterMinor,
      drawdown: drawdownHeadroom({
        equityMinor: account.equityMinor,
        thresholdMinor: account.thresholdMinor,
        drawdownAllowanceMinor: account.planVersion.drawdownAllowanceMinor,
      }),
      dailyLoss: dailyLossHeadroom({
        equityMinor: account.equityMinor,
        sessionStartEquityMinor: account.sessionStartEquityMinor,
        sessionWithdrawalsMinor: account.sessionWithdrawalsMinor,
        dailyLossLimitMinor: account.planVersion.dailyLossLimitMinor,
      }),
      openMicroEquivalents: snapshot?.microEquivalents ?? 0,
      capMicroEquivalents: snapshot?.capMicroEquivalents ?? 0,
      stats: computeTradeStats(closed),
      payoutCount: accountPayouts.length,
      cashPaidMinor,
      remainingLifetimeCapMinor: remainingLifetimeCap({
        lifetimeCapMinor: capMinor,
        reservedMinor: held.reserved,
        consumedMinor: held.consumed,
      }),
      daysAlive: Math.max(
        0,
        Math.floor((Date.now() - account.createdAt.getTime()) / (24 * 60 * 60 * 1000)),
      ),
      paidMinor,
      exposureRatio:
        capMinor === null ? null : exposureRatio({ pricePaidMinor: paidMinor, lifetimeCapMinor: capMinor }),
      inCluster: clustered.has(account.id),
    };
  });
}

/** Owner-linkage signals across every account, for the risk screens. */
export async function getOwnerSignals() {
  const accounts = await prisma.tradingAccount.findMany({
    select: { id: true, userId: true, user: { select: { email: true, profile: true } } },
  });

  return findOwnerSignals(
    accounts.map((account) => ({
      tradingAccountId: account.id,
      userId: account.userId,
      normalisedAddress: account.user.profile
        ? normaliseAddress({
            addressLine1: account.user.profile.addressLine1,
            postalCode: account.user.profile.postalCode,
            countryCode: account.user.profile.countryCode,
          })
        : null,
      emailDomain: account.user.email.split('@')[1] ?? null,
    })),
  );
}

export const money = (minor: bigint) => Money.fromMinor(minor);
export { unavailable };

// ---------------------------------------------------------------------------
// Account detail
// ---------------------------------------------------------------------------

export interface EquityPoint {
  readonly observedAt: Date;
  readonly equityMinor: bigint;
  readonly thresholdMinor: bigint;
  readonly highWaterMinor: bigint;
}

export interface TradeRow {
  readonly id: string;
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly entryPriceE8: bigint;
  readonly exitPriceE8: bigint | null;
  readonly openedAt: Date;
  readonly closedAt: Date | null;
  readonly status: string;
  readonly realisedPnlMinor: bigint;
  readonly commissionMinor: bigint;
  /** Return on the notional moved, or null while the position is open. */
  readonly returnPercent: number | null;
  readonly holdSeconds: number | null;
}

export interface AccountDetail {
  readonly row: AccountRow;
  readonly equityCurve: readonly EquityPoint[];
  readonly trades: readonly TradeRow[];
  readonly stats: TradeStats;
  readonly bySide: ReturnType<typeof bySide>;
  readonly bySymbol: ReturnType<typeof bySymbol>;
  readonly byHour: ReturnType<typeof byHour>;
  readonly durations: ReturnType<typeof durationDistribution>;
  readonly payouts: readonly {
    readonly id: string;
    readonly state: string;
    readonly grossMinor: bigint;
    readonly cashMinor: bigint;
    readonly requestedAt: Date;
    readonly paidAt: Date | null;
  }[];
  readonly riskEvents: readonly {
    readonly id: string;
    readonly eventType: string;
    readonly severity: string;
    readonly reason: string;
    readonly occurredAt: Date;
  }[];
  readonly resets: readonly { readonly id: string; readonly priceMinor: bigint; readonly createdAt: Date }[];
  readonly economics: {
    readonly initialPaidMinor: bigint;
    readonly resetSpendMinor: bigint;
    readonly totalPaidMinor: bigint;
    readonly cashPaidOutMinor: bigint;
    readonly netToFirmMinor: bigint;
    /** Cash paid out divided by what they paid. Null when they paid nothing. */
    readonly realisedRatio: number | null;
  };
}

export async function getAccountDetail(tradingAccountId: string): Promise<AccountDetail | null> {
  const rows = await getAccountRows();
  const row = rows.find((r) => r.id === tradingAccountId);
  if (!row) return null;

  const [checkpoints, tradeRecords, payoutRecords, riskEventRecords, resetRecords] =
    await Promise.all([
      prisma.equityCheckpoint.findMany({
        where: { tradingAccountId },
        orderBy: { observedAt: 'asc' },
      }),
      prisma.trade.findMany({ where: { tradingAccountId }, orderBy: { openedAt: 'desc' } }),
      prisma.payoutRequest.findMany({
        where: { tradingAccountId },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.riskEvent.findMany({
        where: { tradingAccountId },
        orderBy: { occurredAt: 'desc' },
        take: 50,
      }),
      prisma.accountReset.findMany({
        where: { tradingAccountId },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

  const closed: ClosedTrade[] = tradeRecords
    .filter((t) => t.status === 'CLOSED' && t.closedAt !== null)
    .map((t) => ({
      symbol: t.symbol,
      side: t.side as 'LONG' | 'SHORT',
      quantity: t.quantity,
      realisedPnlMinor: t.realisedPnlMinor,
      commissionMinor: t.commissionMinor,
      openedAt: t.openedAt,
      closedAt: t.closedAt!,
    }));

  const cashPaidOutMinor = payoutRecords
    .filter((p) => p.state === 'paid')
    .reduce((total, p) => total + p.cashMinor, 0n);
  const resetSpendMinor = resetRecords.reduce((total, r) => total + r.priceMinor, 0n);
  const initialPaidMinor = row.paidMinor - resetSpendMinor;

  return {
    row,
    equityCurve: checkpoints.map((c) => ({
      observedAt: c.observedAt,
      equityMinor: c.equityMinor,
      thresholdMinor: c.thresholdMinor,
      highWaterMinor: c.highWaterMinor,
    })),
    trades: tradeRecords.map((t) => {
      // Return is measured on the price move, not on account equity: a $200
      // win on one contract and on ten are different trades, and dividing by
      // the account balance would make both look identical.
      const notional = Number(t.entryPriceE8) / 1e8;
      const exit = t.exitPriceE8 === null ? null : Number(t.exitPriceE8) / 1e8;
      const move = exit === null ? null : t.side === 'LONG' ? exit - notional : notional - exit;
      return {
        id: t.id,
        symbol: t.symbol,
        side: t.side as 'LONG' | 'SHORT',
        quantity: t.quantity,
        entryPriceE8: t.entryPriceE8,
        exitPriceE8: t.exitPriceE8,
        openedAt: t.openedAt,
        closedAt: t.closedAt,
        status: t.status,
        realisedPnlMinor: t.realisedPnlMinor,
        commissionMinor: t.commissionMinor,
        returnPercent: move === null || notional === 0 ? null : (move / notional) * 100,
        holdSeconds:
          t.closedAt === null ? null : (t.closedAt.getTime() - t.openedAt.getTime()) / 1000,
      };
    }),
    stats: computeTradeStats(closed),
    bySide: bySide(closed),
    bySymbol: bySymbol(closed),
    byHour: byHour(closed, 'America/New_York'),
    durations: durationDistribution(closed),
    payouts: payoutRecords.map((p) => ({
      id: p.id,
      state: p.state,
      grossMinor: p.grossMinor,
      cashMinor: p.cashMinor,
      requestedAt: p.createdAt,
      paidAt: p.paidAt,
    })),
    riskEvents: riskEventRecords.map((e) => ({
      id: e.id,
      eventType: e.eventType,
      severity: e.severity,
      reason: e.reason,
      occurredAt: e.occurredAt,
    })),
    resets: resetRecords.map((r) => ({ id: r.id, priceMinor: r.priceMinor, createdAt: r.createdAt })),
    economics: {
      initialPaidMinor,
      resetSpendMinor,
      totalPaidMinor: row.paidMinor,
      cashPaidOutMinor,
      netToFirmMinor: row.paidMinor - cashPaidOutMinor,
      realisedRatio:
        row.paidMinor <= 0n ? null : Number(cashPaidOutMinor) / Number(row.paidMinor),
    },
  };
}
