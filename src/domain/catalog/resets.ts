/**
 * Account resets.
 *
 * A trader whose account has breached can pay to restore it to its starting
 * state rather than buying a fresh one. The reset is priced $10 below the
 * account's list price.
 *
 * The important rule is what a reset does NOT restore:
 *
 *   Consumed LIFETIME payout capacity survives a reset.
 *
 * A lifetime cap is an obligation ceiling per account. If a reset — the
 * cheapest purchase in the catalog — cleared it, the cap would be trivially
 * defeated by resetting, and the company's maximum exposure per customer would
 * become unbounded. Daily capacity does roll over, because it always does.
 */

import { Money, usd } from '../money/money';
import { confirmed, proposed, type Governed } from '../config/requirement-status';
import { couponPrice, getPlan, type PlanDefinition, type PlanKey } from './plans';
import { DEFAULT_COUPON } from '../pricing/coupon';

/**
 * A reset costs this much less than the cheapest way to buy the account.
 *
 * Priced against the DISCOUNTED price, not the list price. Against list it
 * would have come out above the coupon price — a reset costing more than a new
 * account, which nobody would ever buy.
 */
export const RESET_DISCOUNT: Governed<Money> = confirmed(
  usd('10.00'),
  'A reset is priced $10 below the discounted account price.',
  'Owner decision',
);

/**
 * Whether a reset restores the balance to the plan's starting figure or to
 * some other point is a policy the owner has not been asked about; restoring
 * to the starting balance is the only behaviour that needs no further decision.
 */
export const RESET_RESTORES_TO_STARTING_BALANCE: Governed<boolean> = proposed(
  true,
  'A reset restores the simulated balance to the plan starting balance and clears the breach.',
  'Derived default — see docs/DECISIONS.md',
);

/**
 * The price a reset undercuts: the discounted account price, since that is what
 * a trader would actually pay to start again.
 */
export function referencePriceForReset(plan: PlanDefinition): Money {
  return couponPrice(plan.listPrice.value, DEFAULT_COUPON.value.percentOff);
}

/** Price of resetting an account on the given plan. */
export function resetPrice(plan: PlanDefinition): Money {
  const price = referencePriceForReset(plan).minus(RESET_DISCOUNT.value);
  if (!price.isPositive()) {
    throw new Error(
      `Reset price for ${plan.key} would be ${price.toDecimalString()}. A reset must cost ` +
        'something; revisit the discount or the list price.',
    );
  }
  return price;
}

export function resetPriceForKey(key: PlanKey): Money {
  return resetPrice(getPlan(key));
}

export type ResetRefusal =
  | 'ACCOUNT_ACTIVE'
  | 'ACCOUNT_PENDING'
  | 'PAYOUT_IN_FLIGHT'
  | 'DATA_STALE'
  | 'NOT_FLAT'
  | 'LIFETIME_CAP_REACHED';

export interface ResetEligibilityInput {
  /** ACTIVE | DAILY_PAUSED | BREACHED | SUSPENDED | CLOSED | PENDING */
  readonly tradingStatus: string;
  /** Any payout request not yet in a terminal state. */
  readonly hasPayoutInFlight: boolean;
  readonly dataIsStale: boolean;
  readonly isFlat: boolean;
  /**
   * True once this account has paid out its whole lifetime cash capacity.
   *
   * A reset restores the balance but NOT consumed payout capacity, so a reset
   * bought here would return an account that can trade and can never pay again.
   * Selling that would be selling nothing.
   */
  readonly lifetimeCapReached: boolean;
}

export interface ResetEligibility {
  readonly allowed: boolean;
  readonly reason: ResetRefusal | null;
  readonly message: string | null;
}

/**
 * A reset is for an account that can no longer trade.
 *
 * It is refused while a payout is in flight: a reset rewrites the very balance
 * a pending request was validated against, and the two settling in either order
 * would produce a payout measured against a balance that no longer exists.
 */
export function checkResetEligibility(input: ResetEligibilityInput): ResetEligibility {
  const refuse = (reason: ResetRefusal, message: string): ResetEligibility => ({
    allowed: false,
    reason,
    message,
  });

  if (input.hasPayoutInFlight) {
    return refuse(
      'PAYOUT_IN_FLIGHT',
      'You have a payout request in progress. A reset would change the balance that request ' +
        'was checked against, so it has to finish first.',
    );
  }
  if (input.tradingStatus === 'PENDING') {
    return refuse('ACCOUNT_PENDING', 'This account is still being set up and cannot be reset yet.');
  }
  if (input.tradingStatus === 'ACTIVE') {
    return refuse(
      'ACCOUNT_ACTIVE',
      'This account is still active. A reset is only available once an account can no longer trade.',
    );
  }
  if (input.tradingStatus === 'DAILY_PAUSED') {
    return refuse(
      'ACCOUNT_ACTIVE',
      'This account is paused for the rest of the session and resumes automatically at the next ' +
        'session. You do not need to pay for a reset.',
    );
  }
  if (input.dataIsStale) {
    return refuse(
      'DATA_STALE',
      'We are waiting for current account data from the platform. Resets are paused until the ' +
        'account reconciles.',
    );
  }
  if (!input.isFlat) {
    return refuse('NOT_FLAT', 'Positions must be closed before this account can be reset.');
  }

  // Checked last, so a trader sees the ordinary blockers first and is not told
  // to buy a new account when the real obstacle is an open position.
  if (input.lifetimeCapReached) {
    return refuse(
      'LIFETIME_CAP_REACHED',
      'This account has paid out its full lifetime cash limit. A reset restores the balance ' +
        'but not payout capacity, so it would give you an account that can trade and can never ' +
        'pay out. Buy a new account to keep earning.',
    );
  }

  return { allowed: true, reason: null, message: null };
}

export interface ResetOutcome {
  readonly restoredBalance: Money;
  readonly restoredHighWater: Money;
  readonly restoredThreshold: Money;
}

/**
 * The state a reset restores.
 *
 * The high-water mark returns to the starting balance, which is what makes the
 * trailing threshold fall back to S - D. This is the one place in the system
 * where the threshold legitimately moves DOWN, and it does so only because the
 * trader has bought a new starting position.
 */
export function computeResetState(
  plan: PlanDefinition,
  trailingStopOffset: Money,
): ResetOutcome {
  const starting = plan.startingBalance;
  const cap = starting.plus(trailingStopOffset);
  const trailing = starting.minus(plan.drawdownAllowance.value);
  return {
    restoredBalance: starting,
    restoredHighWater: starting,
    restoredThreshold: Money.min(cap, trailing),
  };
}
