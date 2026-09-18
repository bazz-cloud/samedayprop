/**
 * Payout eligibility and capacity.
 *
 * What this application pays is a real CASH REWARD calculated against SIMULATED
 * profits. It is not a withdrawal from a funded cash brokerage balance, and the
 * labels used throughout the UI say so.
 *
 * The calculation (docs/PAYOUT_AND_RISK_RULES.md §4):
 *
 *   A = current reconciled SIMULATED balance
 *   S = starting simulated balance
 *   B = retained profit buffer
 *   C = remaining daily CASH payout capacity
 *   L = remaining lifetime CASH capacity, when a cap has been approved
 *   T = current trailing threshold
 *
 *   Gmax = max(0, min(A - S - B, 2C, 2L, A - T - room))
 *
 * floored to the gross increment, and eligible only when Gmax >= $500.
 *
 * The cash paid is exactly Gmax/2 — the confirmed 50/50 split. A $500 gross
 * withdrawal reduces the simulated account by $500 and pays the trader $250 in
 * real cash. The other $250 is NOT company revenue; it is simply simulated
 * balance that ceases to exist.
 *
 * There is deliberately NO minimum trading day, winning day, consistency or
 * best-day test anywhere in this file. Same-day eligibility including the first
 * trading day is a confirmed requirement.
 */

import { Money } from '../money/money';

export type BindingConstraint =
  | 'BUFFER'
  | 'DAILY_CASH_CAP'
  | 'LIFETIME_CASH_CAP'
  | 'TRAILING_ROOM'
  | 'BELOW_MINIMUM';

export interface PayoutContext {
  /** A — reconciled simulated balance, already net of commissions and fees. */
  readonly reconciledBalance: Money;
  /** S — starting simulated balance. */
  readonly startingBalance: Money;
  /** B — retained profit buffer. */
  readonly retainedBuffer: Money;
  /** C — remaining daily CASH capacity after existing reservations. */
  readonly remainingDailyCash: Money;
  /** L — remaining lifetime CASH capacity, or null when uncapped is APPROVED. */
  readonly remainingLifetimeCash: Money | null;
  /** T — current trailing threshold. */
  readonly trailingThreshold: Money;
  /** Equity must exceed T by at least this much after the withdrawal. */
  readonly minPostWithdrawalRoom: Money;
  readonly minimumGross: Money;
  readonly grossIncrement: Money;
}

export interface CapacityComponent {
  readonly constraint: BindingConstraint;
  readonly label: string;
  readonly grossLimit: Money;
}

export interface PayoutCapacity {
  /** Largest gross withdrawal currently permitted, floored to the increment. */
  readonly maxGross: Money;
  /** Real cash that gross would pay: exactly half. */
  readonly maxCash: Money;
  readonly eligible: boolean;
  /** Which limit is holding the trader back right now. */
  readonly binding: BindingConstraint | null;
  readonly components: readonly CapacityComponent[];
  /** Plain-language explanation for the trader dashboard. */
  readonly explanation: string;
}

function nonNegative(value: Money): Money {
  return value.isNegative() ? Money.zero(value.currency) : value;
}

export function computeCapacity(context: PayoutContext): PayoutCapacity {
  const currency = context.reconciledBalance.currency;

  const components: CapacityComponent[] = [
    {
      constraint: 'BUFFER',
      label: 'Profit above your starting balance and retained buffer',
      grossLimit: nonNegative(
        context.reconciledBalance.minus(context.startingBalance).minus(context.retainedBuffer),
      ),
    },
    {
      constraint: 'DAILY_CASH_CAP',
      label: 'Remaining daily cash payout capacity',
      grossLimit: nonNegative(context.remainingDailyCash).timesInt(2),
    },
    {
      constraint: 'TRAILING_ROOM',
      label: 'Room that must remain above your trailing threshold',
      grossLimit: nonNegative(
        context.reconciledBalance
          .minus(context.trailingThreshold)
          .minus(context.minPostWithdrawalRoom),
      ),
    },
  ];

  // The lifetime bound is applied ONLY when a cap has been approved. A null here
  // means the owner explicitly approved an uncapped policy; an undecided cap is
  // rejected upstream and never reaches this function.
  if (context.remainingLifetimeCash !== null) {
    components.splice(2, 0, {
      constraint: 'LIFETIME_CASH_CAP',
      label: 'Remaining lifetime cash payout capacity',
      grossLimit: nonNegative(context.remainingLifetimeCash).timesInt(2),
    });
  }

  const rawMax = Money.min(...components.map((c) => c.grossLimit));
  const maxGross = rawMax.floorToIncrement(context.grossIncrement);
  const eligible = maxGross.gte(context.minimumGross);

  // Report the tightest constraint. Ties resolve to the first in declaration
  // order, which puts the buffer (the most common and most explainable reason)
  // ahead of the caps.
  const binding = eligible
    ? null
    : components.find((c) => c.grossLimit.equals(rawMax))?.constraint ?? 'BELOW_MINIMUM';

  const maxCash = maxGross.isZero() ? Money.zero(currency) : maxGross.halfExact();

  return {
    maxGross,
    maxCash,
    eligible,
    binding: eligible ? null : binding,
    components,
    explanation: explain(context, maxGross, eligible, binding),
  };
}

function explain(
  context: PayoutContext,
  maxGross: Money,
  eligible: boolean,
  binding: BindingConstraint | null,
): string {
  if (eligible) {
    return (
      `You can request up to ${maxGross.format()} gross, which pays ` +
      `${maxGross.halfExact().format()} in cash and leaves ` +
      `${context.reconciledBalance.minus(maxGross).format()} in the simulated account.`
    );
  }
  switch (binding) {
    case 'BUFFER': {
      const needed = context.startingBalance
        .plus(context.retainedBuffer)
        .plus(context.minimumGross);
      return (
        `Your simulated balance must reach ${needed.format()} before the ` +
        `${context.minimumGross.format()} minimum gross withdrawal is available. ` +
        `It is currently ${context.reconciledBalance.format()}.`
      );
    }
    case 'DAILY_CASH_CAP':
      return (
        'You have used your daily cash payout capacity. It refreshes at the start of the ' +
        'next trading session.'
      );
    case 'LIFETIME_CASH_CAP':
      return 'You have reached the lifetime cash payout cap for this account.';
    case 'TRAILING_ROOM':
      return (
        'A withdrawal this size would take your equity to your trailing threshold. ' +
        'Your balance must rise before more can be withdrawn.'
      );
    default:
      return `The available amount is below the ${context.minimumGross.format()} minimum gross withdrawal.`;
  }
}

export type RequestRejection =
  | 'BELOW_MINIMUM'
  | 'ABOVE_CAPACITY'
  | 'NOT_AN_INCREMENT'
  | 'NOT_FLAT'
  | 'CONFLICTING_ORDERS'
  | 'ACCOUNT_NOT_ACTIVE'
  | 'DATA_STALE'
  | 'LIFETIME_CAP_UNRESOLVED';

export interface RequestValidation {
  readonly ok: boolean;
  readonly reason: RequestRejection | null;
  readonly message: string | null;
  readonly gross: Money;
  readonly cash: Money;
  /** Simulated balance remaining after the deduction. */
  readonly balanceAfter: Money;
}

export interface RequestPreconditions {
  /** Positions must be flat before balances can be reconciled and reserved. */
  readonly isFlat: boolean;
  readonly hasConflictingOrders: boolean;
  readonly accountIsActive: boolean;
  /** Authoritative data must be fresh; stale data blocks payouts entirely. */
  readonly dataIsStale: boolean;
}

export function validateRequest(
  context: PayoutContext,
  capacity: PayoutCapacity,
  requestedGross: Money,
  preconditions: RequestPreconditions,
): RequestValidation {
  const fail = (reason: RequestRejection, message: string): RequestValidation => ({
    ok: false,
    reason,
    message,
    gross: requestedGross,
    cash: Money.zero(requestedGross.currency),
    balanceAfter: context.reconciledBalance,
  });

  if (!preconditions.accountIsActive) {
    return fail('ACCOUNT_NOT_ACTIVE', 'This account is not currently active for payouts.');
  }
  if (preconditions.dataIsStale) {
    return fail(
      'DATA_STALE',
      'We have not received fresh authoritative account data. Payouts are paused until ' +
        'the account reconciles.',
    );
  }
  if (!preconditions.isFlat) {
    return fail('NOT_FLAT', 'Close all positions before requesting a payout.');
  }
  if (preconditions.hasConflictingOrders) {
    return fail('CONFLICTING_ORDERS', 'Cancel all working orders before requesting a payout.');
  }
  if (requestedGross.lt(context.minimumGross)) {
    return fail(
      'BELOW_MINIMUM',
      `The minimum gross withdrawal is ${context.minimumGross.format()}.`,
    );
  }
  if (!requestedGross.isMultipleOf(context.grossIncrement)) {
    return fail(
      'NOT_AN_INCREMENT',
      `Gross withdrawals must be a multiple of ${context.grossIncrement.format()}.`,
    );
  }
  if (requestedGross.gt(capacity.maxGross)) {
    return fail(
      'ABOVE_CAPACITY',
      `The most you can request right now is ${capacity.maxGross.format()} gross.`,
    );
  }

  return {
    ok: true,
    reason: null,
    message: null,
    gross: requestedGross,
    cash: requestedGross.halfExact(),
    balanceAfter: context.reconciledBalance.minus(requestedGross),
  };
}

/** The trader's real cash share of a gross withdrawal: exactly half. */
export function cashForGross(gross: Money): Money {
  return gross.halfExact();
}

/**
 * The simulated amount that simply ceases to exist.
 *
 * Named explicitly because it is the single most misunderstood number in the
 * model: it is NOT company revenue and must never be reported as such.
 */
export function companyNonRevenueShare(gross: Money): Money {
  return gross.halfExact();
}
