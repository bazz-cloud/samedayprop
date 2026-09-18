/**
 * Daily and lifetime payout capacity reservations.
 *
 * Capacity is consumed the moment a request is made, not when it settles. That
 * ordering closes three holes:
 *
 *  1. Two concurrent requests cannot each see the full daily cap and both pass.
 *  2. A request that is slow to settle cannot be joined by a second request
 *     that spends the same capacity.
 *  3. A request made on Monday that settles on Wednesday still counts against
 *     MONDAY's cap, so a trader cannot manufacture extra capacity by timing
 *     cancellations and retries around the session boundary.
 *
 * Reservations are released only by a terminal non-paying outcome (canceled,
 * rejected, failed-and-reconciled). A payout that reached `paid` converts its
 * reservation into permanent consumption.
 */

import { Money } from '../money/money';
import type { SessionDate } from '../risk/session';

export type ReservationStatus = 'ACTIVE' | 'CONSUMED' | 'RELEASED';

export interface CapacityReservation {
  readonly id: string;
  readonly payoutRequestId: string;
  /** Session the reservation is attributed to, fixed at request time. */
  readonly sessionDate: SessionDate;
  /** Real CASH reserved (half the gross). */
  readonly cashAmount: Money;
  readonly status: ReservationStatus;
}

export interface CapacityWindow {
  readonly dailyCashCap: Money;
  /** Null only when an uncapped lifetime policy has been explicitly approved. */
  readonly lifetimeCashCap: Money | null;
}

export interface RemainingCapacity {
  readonly remainingDailyCash: Money;
  readonly remainingLifetimeCash: Money | null;
  readonly dailyReserved: Money;
  readonly dailyConsumed: Money;
  readonly lifetimeReserved: Money;
  readonly lifetimeConsumed: Money;
}

function sumWhere(
  reservations: readonly CapacityReservation[],
  predicate: (r: CapacityReservation) => boolean,
  currency: Money,
): Money {
  return reservations
    .filter(predicate)
    .reduce((total, r) => total.plus(r.cashAmount), Money.zero(currency.currency));
}

function clampNonNegative(value: Money): Money {
  return value.isNegative() ? Money.zero(value.currency) : value;
}

/**
 * Remaining capacity for `sessionDate`, given every reservation ever made on
 * this account.
 *
 * Both ACTIVE (pending) and CONSUMED (paid) reservations count against the cap.
 * RELEASED ones do not.
 */
export function computeRemainingCapacity(
  window: CapacityWindow,
  reservations: readonly CapacityReservation[],
  sessionDate: SessionDate,
): RemainingCapacity {
  const zero = window.dailyCashCap;

  const dailyReserved = sumWhere(
    reservations,
    (r) => r.sessionDate === sessionDate && r.status === 'ACTIVE',
    zero,
  );
  const dailyConsumed = sumWhere(
    reservations,
    (r) => r.sessionDate === sessionDate && r.status === 'CONSUMED',
    zero,
  );
  const lifetimeReserved = sumWhere(reservations, (r) => r.status === 'ACTIVE', zero);
  const lifetimeConsumed = sumWhere(reservations, (r) => r.status === 'CONSUMED', zero);

  const remainingDailyCash = clampNonNegative(
    window.dailyCashCap.minus(dailyReserved).minus(dailyConsumed),
  );

  const remainingLifetimeCash =
    window.lifetimeCashCap === null
      ? null
      : clampNonNegative(window.lifetimeCashCap.minus(lifetimeReserved).minus(lifetimeConsumed));

  return {
    remainingDailyCash,
    remainingLifetimeCash,
    dailyReserved,
    dailyConsumed,
    lifetimeReserved,
    lifetimeConsumed,
  };
}

export type ReservationOutcome =
  | { readonly ok: true; readonly reservation: CapacityReservation }
  | { readonly ok: false; readonly reason: 'DAILY_CAP_EXCEEDED' | 'LIFETIME_CAP_EXCEEDED'; readonly message: string };

/**
 * Attempt to reserve capacity.
 *
 * This is the pure decision half. The persistence layer applies it inside a
 * serialisable transaction that re-reads existing reservations, so two
 * concurrent callers cannot both observe the pre-reservation state.
 */
export function reserveCapacity(
  window: CapacityWindow,
  existing: readonly CapacityReservation[],
  request: { id: string; payoutRequestId: string; sessionDate: SessionDate; cashAmount: Money },
): ReservationOutcome {
  const remaining = computeRemainingCapacity(window, existing, request.sessionDate);

  if (request.cashAmount.gt(remaining.remainingDailyCash)) {
    return {
      ok: false,
      reason: 'DAILY_CAP_EXCEEDED',
      message:
        `Requested ${request.cashAmount.format()} cash but only ` +
        `${remaining.remainingDailyCash.format()} of today's capacity remains.`,
    };
  }

  if (
    remaining.remainingLifetimeCash !== null &&
    request.cashAmount.gt(remaining.remainingLifetimeCash)
  ) {
    return {
      ok: false,
      reason: 'LIFETIME_CAP_EXCEEDED',
      message:
        `Requested ${request.cashAmount.format()} cash but only ` +
        `${remaining.remainingLifetimeCash.format()} of the lifetime cap remains.`,
    };
  }

  return {
    ok: true,
    reservation: {
      id: request.id,
      payoutRequestId: request.payoutRequestId,
      sessionDate: request.sessionDate,
      cashAmount: request.cashAmount,
      status: 'ACTIVE',
    },
  };
}

export function consumeReservation(reservation: CapacityReservation): CapacityReservation {
  if (reservation.status !== 'ACTIVE') {
    throw new Error(`Cannot consume a ${reservation.status} reservation`);
  }
  return { ...reservation, status: 'CONSUMED' };
}

export function releaseReservation(reservation: CapacityReservation): CapacityReservation {
  if (reservation.status === 'CONSUMED') {
    throw new Error(
      'Cannot release a reservation that has already been paid. Releasing it would hand ' +
        'back capacity the trader has actually used.',
    );
  }
  return { ...reservation, status: 'RELEASED' };
}
