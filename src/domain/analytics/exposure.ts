/**
 * Firm exposure and per-account headroom.
 *
 * These are the numbers the console exists to show. Two in particular:
 *
 *   HEADROOM      how close an account is to dying. Equity minus the trailing
 *                 threshold, and the remaining daily loss allowance.
 *   EXPOSURE      how much the firm could still owe. Remaining lifetime cash
 *                 capacity, summed.
 *
 * Both are exact integer arithmetic on minor units. A cent of drift in a
 * trailing-drawdown calculation is a payout dispute, so nothing here converts
 * money to a float; only the RATIOS used for colour bands become numbers, and
 * those are presentation.
 */

export type HeadroomBand = 'COMFORTABLE' | 'TIGHT' | 'CRITICAL';

/** Under 25% of the limit is tight; under 10% is critical. */
export const TIGHT_FRACTION = 0.25;
export const CRITICAL_FRACTION = 0.1;

export interface Headroom {
  /** Remaining room in minor units. Never negative — zero means breached. */
  readonly remainingMinor: bigint;
  /** The allowance this room is measured against. */
  readonly limitMinor: bigint;
  /** remaining / limit, or null when there is no limit to measure against. */
  readonly fraction: number | null;
  readonly band: HeadroomBand;
}

function clampToZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function bandFor(fraction: number | null): HeadroomBand {
  if (fraction === null) return 'COMFORTABLE';
  if (fraction <= CRITICAL_FRACTION) return 'CRITICAL';
  if (fraction <= TIGHT_FRACTION) return 'TIGHT';
  return 'COMFORTABLE';
}

function headroom(remainingMinor: bigint, limitMinor: bigint): Headroom {
  const remaining = clampToZero(remainingMinor);
  const fraction = limitMinor <= 0n ? null : Number(remaining) / Number(limitMinor);
  return { remainingMinor: remaining, limitMinor, fraction, band: bandFor(fraction) };
}

/**
 * How far equity can fall before the trailing threshold is hit.
 *
 * Touching the threshold is a breach, not only falling below it, so an account
 * sitting exactly on it has zero headroom and is already gone.
 */
export function drawdownHeadroom(input: {
  equityMinor: bigint;
  thresholdMinor: bigint;
  drawdownAllowanceMinor: bigint;
}): Headroom {
  return headroom(input.equityMinor - input.thresholdMinor, input.drawdownAllowanceMinor);
}

/**
 * How much more can be lost this session before the daily limit trips.
 *
 * Measured against the session's opening equity, with withdrawals added back:
 * taking money out lowers equity but is not a trading loss, and counting it as
 * one would lock a trader out for getting paid.
 */
export function dailyLossHeadroom(input: {
  equityMinor: bigint;
  sessionStartEquityMinor: bigint;
  sessionWithdrawalsMinor: bigint;
  dailyLossLimitMinor: bigint;
}): Headroom {
  const tradingResult =
    input.equityMinor + input.sessionWithdrawalsMinor - input.sessionStartEquityMinor;
  // A profitable session has the whole allowance intact, never more than it.
  const used = tradingResult < 0n ? -tradingResult : 0n;
  return headroom(input.dailyLossLimitMinor - used, input.dailyLossLimitMinor);
}

/**
 * Cash this account could still be paid over its lifetime.
 *
 * Reserved capacity counts as consumed: a request in flight has already claimed
 * it, and treating it as available would let two requests share one allowance.
 * Null means an uncapped policy was explicitly approved — unbounded, not zero.
 */
export function remainingLifetimeCap(input: {
  lifetimeCapMinor: bigint | null;
  reservedMinor: bigint;
  consumedMinor: bigint;
}): bigint | null {
  if (input.lifetimeCapMinor === null) return null;
  return clampToZero(input.lifetimeCapMinor - input.reservedMinor - input.consumedMinor);
}

export interface AccountExposure {
  readonly tradingAccountId: string;
  readonly remainingLifetimeCapMinor: bigint | null;
  readonly isLive: boolean;
}

export interface FirmExposure {
  /** Sum of remaining capacity across live accounts. */
  readonly openExposureMinor: bigint;
  /** Live accounts whose cap is uncapped-by-approval. */
  readonly uncappedAccounts: number;
  readonly liveAccounts: number;
}

/**
 * Theoretical maximum the firm could still owe.
 *
 * Dead accounts are excluded — a blown account cannot request a payout — but
 * uncapped ones are COUNTED SEPARATELY rather than folded in as zero. An
 * uncapped account contributes an unbounded amount, and quietly adding nothing
 * would understate the very number this function exists to report.
 */
export function firmExposure(accounts: readonly AccountExposure[]): FirmExposure {
  const live = accounts.filter((a) => a.isLive);
  return {
    openExposureMinor: live.reduce(
      (total, a) => total + (a.remainingLifetimeCapMinor ?? 0n),
      0n,
    ),
    uncappedAccounts: live.filter((a) => a.remainingLifetimeCapMinor === null).length,
    liveAccounts: live.length,
  };
}

/**
 * What one customer's worst case costs relative to what they paid.
 *
 * The number that decides whether the business works. Null when nothing was
 * paid, because dividing by zero would report an infinite ratio for a free
 * account rather than saying it cannot be expressed.
 */
export function exposureRatio(input: {
  pricePaidMinor: bigint;
  lifetimeCapMinor: bigint;
}): number | null {
  if (input.pricePaidMinor <= 0n) return null;
  return Number(input.lifetimeCapMinor) / Number(input.pricePaidMinor);
}
