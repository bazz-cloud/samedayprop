/**
 * Intraday trailing drawdown.
 *
 * The threshold follows equity THROUGHOUT the day, including unrealized gains,
 * and never moves back down.
 *
 *   S = starting simulated balance
 *   D = drawdown allowance for the plan
 *   H = highest observed authoritative intraday equity, net of modelled costs,
 *       initialised to S
 *   T = min(S + stopOffset, H - D)
 *
 * Two properties the rest of the system depends on, enforced here and asserted
 * in tests:
 *
 *  1. H rises on unrealized peaks, so a trader who runs up an open position and
 *     gives it back is measured against the peak, not the close.
 *  2. Neither H nor T EVER decreases — not after a trading loss, and not after
 *     a withdrawal. A withdrawal reduces equity and therefore reduces remaining
 *     room; it must not hand back drawdown room by dragging the threshold down.
 *
 * Once H - D reaches S + stopOffset the threshold stops rising, so the account
 * locks in a small profit floor rather than trailing indefinitely. That stop is
 * a PROPOSED policy and is configurable and versioned.
 */

import { Money } from '../money/money';

export interface TrailingParams {
  /** S — starting simulated balance. */
  readonly startingBalance: Money;
  /** D — drawdown allowance. */
  readonly drawdownAllowance: Money;
  /** Threshold stops rising at S + this. */
  readonly stopOffset: Money;
}

export interface TrailingState {
  /** H — highest observed authoritative equity. Monotonically non-decreasing. */
  readonly highWater: Money;
  /** T — breach threshold. Monotonically non-decreasing. */
  readonly threshold: Money;
  /** True once the threshold has reached its stopping point and can rise no further. */
  readonly thresholdIsCapped: boolean;
}

export function computeThreshold(params: TrailingParams, highWater: Money): Money {
  const cap = params.startingBalance.plus(params.stopOffset);
  const trailing = highWater.minus(params.drawdownAllowance);
  return Money.min(cap, trailing);
}

export function initialTrailingState(params: TrailingParams): TrailingState {
  const highWater = params.startingBalance;
  const threshold = computeThreshold(params, highWater);
  return {
    highWater,
    threshold,
    thresholdIsCapped: threshold.equals(params.startingBalance.plus(params.stopOffset)),
  };
}

/**
 * Fold one authoritative equity observation into the trailing state.
 *
 * `equity` must be an authoritative, cost-net figure from the provider or the
 * reconciled internal balance — never a client-reported number.
 */
export function applyEquityObservation(
  params: TrailingParams,
  state: TrailingState,
  equity: Money,
): TrailingState {
  const highWater = Money.max(state.highWater, equity);
  const computed = computeThreshold(params, highWater);

  // The formula is already monotonic given a monotonic H, but clamping makes the
  // guarantee explicit and survives a future edit to the formula or a corrected
  // parameter arriving mid-session.
  const threshold = Money.max(state.threshold, computed);

  return {
    highWater,
    threshold,
    thresholdIsCapped: threshold.equals(params.startingBalance.plus(params.stopOffset)),
  };
}

/**
 * Apply a withdrawal deduction.
 *
 * Deliberately a no-op on the trailing state: a withdrawal lowers equity but is
 * not a trading loss and must not move H or T. Exists as a named function so
 * the call site reads as an explicit decision rather than an omission.
 */
export function applyWithdrawalDeduction(state: TrailingState): TrailingState {
  return state;
}

/** Equity touching or falling below the threshold is an overall breach. */
export function isTrailingBreached(state: TrailingState, equity: Money): boolean {
  return equity.lte(state.threshold);
}

/** Room remaining before the trailing threshold is hit. Never negative. */
export function remainingTrailingRoom(state: TrailingState, equity: Money): Money {
  const room = equity.minus(state.threshold);
  return room.isNegative() ? Money.zero(equity.currency) : room;
}
