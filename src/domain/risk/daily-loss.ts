/**
 * Daily loss limit.
 *
 * Session trading P&L is realized plus unrealized, net of modelled commissions
 * and fees. The subtle part is what does NOT count:
 *
 *   Gross withdrawal deductions are cashflow-like simulated adjustments, not
 *   trading losses. They reduce account equity (and therefore remaining
 *   trailing room) but they are EXCLUDED from daily loss.
 *
 * Without that exclusion, a trader who withdrew $2,000 in the morning would be
 * treated as having lost $2,000 and could be locked out of a flat, profitable
 * account. The arithmetic:
 *
 *   currentEquity = sessionStartEquity + tradingPnl - withdrawalDeductions
 *   => tradingPnl = currentEquity - sessionStartEquity + withdrawalDeductions
 *
 * Commissions and fees are already inside `currentEquity`; they are never
 * subtracted a second time here.
 */

import { Money } from '../money/money';
import type { SessionDate } from './session';

export interface DailyLossState {
  readonly sessionDate: SessionDate;
  /** Authoritative equity at the moment the session opened. */
  readonly sessionStartEquity: Money;
  /** Total GROSS withdrawal deducted during this session. Non-negative. */
  readonly withdrawalDeductions: Money;
}

export function openSession(sessionDate: SessionDate, equityAtOpen: Money): DailyLossState {
  return {
    sessionDate,
    sessionStartEquity: equityAtOpen,
    withdrawalDeductions: Money.zero(equityAtOpen.currency),
  };
}

export function recordWithdrawalDeduction(state: DailyLossState, gross: Money): DailyLossState {
  if (gross.isNegative()) throw new Error('Withdrawal deduction must be non-negative');
  return { ...state, withdrawalDeductions: state.withdrawalDeductions.plus(gross) };
}

/** Session trading P&L: positive is profit. Excludes withdrawal deductions. */
export function sessionTradingPnl(state: DailyLossState, currentEquity: Money): Money {
  return currentEquity.minus(state.sessionStartEquity).plus(state.withdrawalDeductions);
}

/** How much of the daily loss allowance has been consumed. Never negative. */
export function dailyLossUsed(state: DailyLossState, currentEquity: Money): Money {
  const pnl = sessionTradingPnl(state, currentEquity);
  return pnl.isNegative() ? pnl.negated() : Money.zero(currentEquity.currency);
}

export function dailyLossRemaining(
  state: DailyLossState,
  currentEquity: Money,
  limit: Money,
): Money {
  const remaining = limit.minus(dailyLossUsed(state, currentEquity));
  return remaining.isNegative() ? Money.zero(limit.currency) : remaining;
}

/** True once the session loss has reached the plan's daily loss limit. */
export function isDailyLossBreached(
  state: DailyLossState,
  currentEquity: Money,
  limit: Money,
): boolean {
  return dailyLossUsed(state, currentEquity).gte(limit);
}
