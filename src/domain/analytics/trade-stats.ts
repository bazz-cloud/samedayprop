/**
 * Trading statistics, derived from closed trades.
 *
 * Pure functions over plain inputs: no database, no Prisma types, no dates from
 * "now". Everything here is a number a decision gets made on, so everything
 * here is directly testable and none of it can drift with wall-clock time.
 *
 * Two rules throughout:
 *
 *   - Money stays in BigInt minor units. Ratios that cannot be expressed as
 *     integers (win rate, profit factor) are returned as an explicit numerator
 *     and denominator as well as a number, so a caller that needs exactness has
 *     it and a caller that just wants to render a percentage does not have to
 *     reconstruct it.
 *   - A statistic with no denominator is NULL, never zero. Zero win rate and
 *     "no trades yet" are different facts, and a dashboard that renders 0%
 *     for an account that has never traded is lying.
 */

export interface ClosedTrade {
  readonly symbol: string;
  readonly side: 'LONG' | 'SHORT';
  readonly quantity: number;
  readonly realisedPnlMinor: bigint;
  readonly commissionMinor: bigint;
  readonly openedAt: Date;
  readonly closedAt: Date;
}

export interface Ratio {
  readonly numerator: number;
  readonly denominator: number;
  /** Null when the denominator is zero. */
  readonly value: number | null;
}

function ratio(numerator: number, denominator: number): Ratio {
  return {
    numerator,
    denominator,
    value: denominator === 0 ? null : numerator / denominator,
  };
}

export interface TradeStats {
  readonly trades: number;
  readonly wins: number;
  readonly losses: number;
  /** Trades that closed exactly flat. Counted, and excluded from win rate. */
  readonly scratches: number;
  readonly winRate: Ratio;
  readonly netPnlMinor: bigint;
  readonly grossProfitMinor: bigint;
  readonly grossLossMinor: bigint;
  readonly commissionMinor: bigint;
  /**
   * Gross profit / gross loss. Null when there are no losses — an account that
   * has never lost has no profit factor, and Infinity renders badly and
   * compares worse.
   */
  readonly profitFactor: number | null;
  /** Mean P&L per trade, in minor units, rounded toward zero. */
  readonly expectancyMinor: bigint | null;
  readonly averageWinMinor: bigint | null;
  readonly averageLossMinor: bigint | null;
  readonly largestWinMinor: bigint | null;
  readonly largestLossMinor: bigint | null;
  /** Mean hold time in seconds. */
  readonly averageHoldSeconds: number | null;
}

const sum = (values: readonly bigint[]) => values.reduce((total, v) => total + v, 0n);

/** Integer mean, rounded toward zero so a mean never invents a fraction. */
function meanMinor(values: readonly bigint[]): bigint | null {
  if (values.length === 0) return null;
  return sum(values) / BigInt(values.length);
}

export function computeTradeStats(trades: readonly ClosedTrade[]): TradeStats {
  const wins = trades.filter((t) => t.realisedPnlMinor > 0n);
  const losses = trades.filter((t) => t.realisedPnlMinor < 0n);
  const scratches = trades.filter((t) => t.realisedPnlMinor === 0n);

  const grossProfitMinor = sum(wins.map((t) => t.realisedPnlMinor));
  // Held positive, so profit factor is a ratio of two positive magnitudes.
  const grossLossMinor = -sum(losses.map((t) => t.realisedPnlMinor));

  const holdSeconds = trades.map(
    (t) => (t.closedAt.getTime() - t.openedAt.getTime()) / 1000,
  );

  return {
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    scratches: scratches.length,
    // A scratch is neither a win nor a loss, so it is out of the denominator.
    winRate: ratio(wins.length, wins.length + losses.length),
    netPnlMinor: sum(trades.map((t) => t.realisedPnlMinor)),
    grossProfitMinor,
    grossLossMinor,
    commissionMinor: sum(trades.map((t) => t.commissionMinor)),
    profitFactor:
      grossLossMinor === 0n ? null : Number(grossProfitMinor) / Number(grossLossMinor),
    expectancyMinor: meanMinor(trades.map((t) => t.realisedPnlMinor)),
    averageWinMinor: meanMinor(wins.map((t) => t.realisedPnlMinor)),
    averageLossMinor: meanMinor(losses.map((t) => t.realisedPnlMinor)),
    largestWinMinor: wins.length
      ? wins.reduce((a, b) => (b.realisedPnlMinor > a ? b.realisedPnlMinor : a), wins[0]!.realisedPnlMinor)
      : null,
    largestLossMinor: losses.length
      ? losses.reduce((a, b) => (b.realisedPnlMinor < a ? b.realisedPnlMinor : a), losses[0]!.realisedPnlMinor)
      : null,
    averageHoldSeconds:
      holdSeconds.length === 0
        ? null
        : holdSeconds.reduce((a, b) => a + b, 0) / holdSeconds.length,
  };
}

/** Stats split by direction, for the long-vs-short panel. */
export function bySide(trades: readonly ClosedTrade[]): {
  long: TradeStats;
  short: TradeStats;
} {
  return {
    long: computeTradeStats(trades.filter((t) => t.side === 'LONG')),
    short: computeTradeStats(trades.filter((t) => t.side === 'SHORT')),
  };
}

/** Stats per symbol, ordered by net P&L descending. */
export function bySymbol(
  trades: readonly ClosedTrade[],
): readonly { symbol: string; stats: TradeStats }[] {
  const symbols = [...new Set(trades.map((t) => t.symbol))];
  return symbols
    .map((symbol) => ({
      symbol,
      stats: computeTradeStats(trades.filter((t) => t.symbol === symbol)),
    }))
    .sort((a, b) => Number(b.stats.netPnlMinor - a.stats.netPnlMinor));
}

/**
 * Win rate by hour of the trading session, in a named IANA zone.
 *
 * The zone matters: bucketing by UTC hour would scatter a trader's morning
 * across two buckets twice a year when the clocks change.
 */
export function byHour(
  trades: readonly ClosedTrade[],
  timeZone: string,
): readonly { hour: number; stats: TradeStats }[] {
  const formatter = new Intl.DateTimeFormat('en-US', {
    hour: 'numeric',
    hour12: false,
    timeZone,
  });

  const buckets = new Map<number, ClosedTrade[]>();
  for (const trade of trades) {
    // "24" is how some locales render midnight; fold it back to 0.
    const hour = Number(formatter.format(trade.openedAt)) % 24;
    const bucket = buckets.get(hour);
    if (bucket) bucket.push(trade);
    else buckets.set(hour, [trade]);
  }

  return [...buckets.entries()]
    .map(([hour, bucketTrades]) => ({ hour, stats: computeTradeStats(bucketTrades) }))
    .sort((a, b) => a.hour - b.hour);
}

/** Hold-time distribution, in the buckets a trader actually thinks in. */
export const DURATION_BUCKETS: readonly { label: string; maxSeconds: number }[] = [
  { label: 'Under 1m', maxSeconds: 60 },
  { label: '1–5m', maxSeconds: 300 },
  { label: '5–30m', maxSeconds: 1800 },
  { label: '30m–2h', maxSeconds: 7200 },
  { label: 'Over 2h', maxSeconds: Number.POSITIVE_INFINITY },
];

export function durationDistribution(
  trades: readonly ClosedTrade[],
): readonly { label: string; count: number }[] {
  return DURATION_BUCKETS.map((bucket, index) => {
    const lower = index === 0 ? 0 : DURATION_BUCKETS[index - 1]!.maxSeconds;
    return {
      label: bucket.label,
      count: trades.filter((t) => {
        const seconds = (t.closedAt.getTime() - t.openedAt.getTime()) / 1000;
        return seconds > lower && seconds <= bucket.maxSeconds;
      }).length,
    };
  });
}
