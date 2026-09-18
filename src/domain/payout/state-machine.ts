/**
 * Payout request lifecycle.
 *
 * The transitions below encode one rule above all others:
 *
 *   An UNKNOWN payment outcome is not a failure.
 *
 * Once a payout has been submitted to a payment provider, the only honest
 * responses are "confirmed paid", "confirmed not paid", or "we do not yet know".
 * A submitted request may therefore never jump straight to `canceled` or have
 * its simulated deduction reversed — doing so could hand the trader their
 * simulated balance back while the cash payment is in flight or already
 * settled. Unknown outcomes go to `needs_reconciliation` and stay there until a
 * provider lookup resolves them.
 */

export type PayoutState =
  /** Trader submitted the request; nothing reserved yet. */
  | 'requested'
  /** Daily and lifetime cash capacity reserved. */
  | 'reserved'
  /** Re-checking balances, flat status and rules against fresh provider data. */
  | 'validating'
  /** Cleared for payment, automatically or by an operator. */
  | 'approved'
  /** Handed to the payment provider; outcome not yet known. */
  | 'submitted'
  /** Cash confirmed sent. Terminal. */
  | 'paid'
  /** Provider confirmed the payment did NOT happen. */
  | 'failed'
  /** Withdrawn before submission. Terminal. */
  | 'canceled'
  /** Declined on policy or eligibility grounds. Terminal. */
  | 'rejected'
  /** Outcome unknown or records disagree; requires human/automated resolution. */
  | 'needs_reconciliation';

export const PAYOUT_STATES: readonly PayoutState[] = [
  'requested',
  'reserved',
  'validating',
  'approved',
  'submitted',
  'paid',
  'failed',
  'canceled',
  'rejected',
  'needs_reconciliation',
];

export const TERMINAL_PAYOUT_STATES: readonly PayoutState[] = [
  'paid',
  'canceled',
  'rejected',
];

const TRANSITIONS: Record<PayoutState, readonly PayoutState[]> = {
  requested: ['reserved', 'rejected', 'canceled'],
  reserved: ['validating', 'rejected', 'canceled'],
  validating: ['approved', 'rejected', 'canceled', 'needs_reconciliation'],
  approved: ['submitted', 'canceled', 'needs_reconciliation'],
  // Deliberately no `canceled` here: once money may be moving, the only exits
  // are a confirmed outcome or reconciliation.
  submitted: ['paid', 'failed', 'needs_reconciliation'],
  // A confirmed failure may be retried (back to approved) or closed out.
  failed: ['approved', 'needs_reconciliation', 'canceled'],
  needs_reconciliation: ['paid', 'failed', 'canceled', 'approved'],
  paid: [],
  canceled: [],
  rejected: [],
};

export class PayoutTransitionError extends Error {}

export function canTransition(from: PayoutState, to: PayoutState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: PayoutState, to: PayoutState): void {
  if (!canTransition(from, to)) {
    throw new PayoutTransitionError(
      `Illegal payout transition ${from} -> ${to}. Allowed from ${from}: ` +
        `${TRANSITIONS[from].join(', ') || '(terminal)'}`,
    );
  }
}

export function isTerminal(state: PayoutState): boolean {
  return TERMINAL_PAYOUT_STATES.includes(state);
}

/** States in which capacity is still held against the caps. */
export function holdsCapacity(state: PayoutState): boolean {
  return (
    state === 'reserved' ||
    state === 'validating' ||
    state === 'approved' ||
    state === 'submitted' ||
    state === 'failed' ||
    state === 'needs_reconciliation' ||
    state === 'paid'
  );
}

/**
 * Whether the simulated balance deduction may be reversed.
 *
 * Only when the provider has CONFIRMED that no cash moved. An unknown outcome
 * is never sufficient.
 */
export function mayReverseSimulatedDeduction(
  state: PayoutState,
  providerOutcomeConfirmed: boolean,
): boolean {
  if (state === 'paid') return false;
  if (state === 'needs_reconciliation') return false;
  if (state === 'failed') return providerOutcomeConfirmed;
  if (state === 'canceled' || state === 'rejected') return true;
  return false;
}

/** Whether the trader may still withdraw the request themselves. */
export function traderMayCancel(state: PayoutState): boolean {
  return state === 'requested' || state === 'reserved' || state === 'validating';
}

/**
 * A pending or earned payout must not be silently voided by an unrelated
 * account state change. A later breach does not erase an obligation that was
 * already validly earned; it routes to review with a recorded reason instead.
 */
export function breachShouldCancelPayout(): false {
  return false;
}
