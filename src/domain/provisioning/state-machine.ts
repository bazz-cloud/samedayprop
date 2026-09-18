/**
 * Account provisioning lifecycle.
 *
 *   payment_pending -> paid -> provisioning -> active
 *
 * plus explicit retryable failure, permanent failure and manual review states.
 *
 * Two rules the rest of the system relies on:
 *
 *  1. `active` is reachable ONLY from `risk_verified`. An account is never
 *     presented as tradeable until the provider has confirmed the risk limits
 *     and entitlements are actually in place. A provisioning call that appeared
 *     to succeed but whose risk configuration could not be read back is not
 *     success.
 *  2. A failure AFTER successful payment never silently disappears. It lands in
 *     `provisioning_failed_retryable` or `manual_review`, both of which are
 *     visible to the trader as a truthful pending state and to operations as an
 *     alert.
 */

export type ProvisioningState =
  /** Order created, payment not yet confirmed. */
  | 'payment_pending'
  /** Payment verified by the provider webhook or a server-side lookup. */
  | 'paid'
  /** Identity/account creation in flight at the trading provider. */
  | 'provisioning'
  /** External account exists; risk configuration not yet verified. */
  | 'provisioned_unverified'
  /** Risk limits and entitlements read back and confirmed. */
  | 'risk_verified'
  /** Trader may trade. */
  | 'active'
  /** Transient failure; bounded automatic retries remain. */
  | 'provisioning_failed_retryable'
  /** Retries exhausted or a non-retryable error; operations must intervene. */
  | 'manual_review'
  /** Permanently abandoned, typically alongside a refund. */
  | 'provisioning_failed_permanent';

export const PROVISIONING_STATES: readonly ProvisioningState[] = [
  'payment_pending',
  'paid',
  'provisioning',
  'provisioned_unverified',
  'risk_verified',
  'active',
  'provisioning_failed_retryable',
  'manual_review',
  'provisioning_failed_permanent',
];

const TRANSITIONS: Record<ProvisioningState, readonly ProvisioningState[]> = {
  payment_pending: ['paid', 'provisioning_failed_permanent'],
  paid: ['provisioning', 'manual_review'],
  provisioning: ['provisioned_unverified', 'provisioning_failed_retryable', 'manual_review'],
  provisioned_unverified: ['risk_verified', 'provisioning_failed_retryable', 'manual_review'],
  // The only path to `active`.
  risk_verified: ['active', 'manual_review'],
  active: ['manual_review'],
  provisioning_failed_retryable: ['provisioning', 'manual_review'],
  manual_review: ['provisioning', 'risk_verified', 'active', 'provisioning_failed_permanent'],
  provisioning_failed_permanent: [],
};

export class ProvisioningTransitionError extends Error {}

export function canTransition(from: ProvisioningState, to: ProvisioningState): boolean {
  return TRANSITIONS[from].includes(to);
}

export function assertTransition(from: ProvisioningState, to: ProvisioningState): void {
  if (!canTransition(from, to)) {
    throw new ProvisioningTransitionError(
      `Illegal provisioning transition ${from} -> ${to}. Allowed from ${from}: ` +
        `${TRANSITIONS[from].join(', ') || '(terminal)'}`,
    );
  }
}

/** States the trader should see as "working on it", not as failure. */
export function isInProgress(state: ProvisioningState): boolean {
  return (
    state === 'paid' ||
    state === 'provisioning' ||
    state === 'provisioned_unverified' ||
    state === 'risk_verified' ||
    state === 'provisioning_failed_retryable' ||
    state === 'manual_review'
  );
}

export function isTradeable(state: ProvisioningState): boolean {
  return state === 'active';
}

/** Whether operations should be paged. */
export function requiresOperatorAttention(state: ProvisioningState): boolean {
  return state === 'manual_review' || state === 'provisioning_failed_permanent';
}

export const MAX_AUTOMATIC_RETRIES = 5;

/** Bounded retries; exhaustion routes to a human rather than looping forever. */
export function nextStateAfterFailure(
  attempts: number,
  retryable: boolean,
): ProvisioningState {
  if (!retryable) return 'manual_review';
  return attempts >= MAX_AUTOMATIC_RETRIES ? 'manual_review' : 'provisioning_failed_retryable';
}

/** Customer-facing status text. Never claims an account exists when it does not. */
export function traderFacingStatus(state: ProvisioningState): {
  headline: string;
  detail: string;
} {
  switch (state) {
    case 'payment_pending':
      return {
        headline: 'Waiting for payment confirmation',
        detail: 'We have not yet confirmed your payment with the payment provider.',
      };
    case 'paid':
      return {
        headline: 'Payment confirmed — queued for setup',
        detail: 'Your payment is confirmed. Your simulated account has not been created yet.',
      };
    case 'provisioning':
      return {
        headline: 'Creating your simulated account',
        detail: 'We are setting up your trading platform access. This is not finished yet.',
      };
    case 'provisioned_unverified':
      return {
        headline: 'Verifying your account limits',
        detail:
          'Your simulated account exists. We are confirming the risk limits before enabling trading.',
      };
    case 'risk_verified':
      return {
        headline: 'Limits verified — finishing up',
        detail: 'Your risk limits are confirmed. Enabling trading access now.',
      };
    case 'active':
      return {
        headline: 'Active',
        detail: 'Your simulated account is ready to trade.',
      };
    case 'provisioning_failed_retryable':
      return {
        headline: 'Setup delayed — retrying',
        detail:
          'Setup did not complete. We are retrying automatically. Your payment is safe and ' +
          'no account has been created yet.',
      };
    case 'manual_review':
      return {
        headline: 'Setup needs our attention',
        detail:
          'Automatic setup did not complete and our team has been notified. We will contact ' +
          'you. Your payment is recorded and you are entitled to support or a refund under ' +
          'the published policy.',
      };
    case 'provisioning_failed_permanent':
      return {
        headline: 'Setup could not be completed',
        detail:
          'We could not create your simulated account. Your order has been closed and a ' +
          'refund is being handled under the published policy.',
      };
  }
}
