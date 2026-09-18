'use client';

import { useActionState } from 'react';
import { purchaseReset, type ResetActionState } from '@/app/dashboard/reset-actions';
import { Callout, Card } from './ui';

const INITIAL: ResetActionState = { error: null, success: null };

export interface ResetOfferView {
  tradingAccountId: string;
  planLabel: string;
  price: string;
  newAccountPrice: string;
  saving: string;
  allowed: boolean;
  reason: string | null;
  resetCount: number;
  idempotencyKey: string;
  isDemo: boolean;
}

/**
 * Reset offer.
 *
 * Shown on an account that can no longer trade. States plainly what a reset
 * does not restore, because a trader who expects their lifetime payout capacity
 * back would otherwise discover it after paying.
 */
export function ResetCard({ offer }: { offer: ResetOfferView }) {
  const [state, formAction, pending] = useActionState(purchaseReset, INITIAL);

  return (
    <Card className="p-5">
      <h2 className="font-semibold mb-1">Reset this account</h2>
      <p className="text-xs text-fg-subtle mb-4">
        Restores your starting balance and clears the breach for{' '}
        <span className="text-accent font-semibold">{offer.saving}</span> less than buying a new
        account.
      </p>

      {state.error && (
        <div className="mb-3" role="alert">
          <Callout tone="danger">{state.error}</Callout>
        </div>
      )}
      {state.success && (
        <div className="mb-3" role="status">
          <Callout tone="accent">{state.success}</Callout>
        </div>
      )}

      <dl className="text-sm mb-4">
        <div className="flex justify-between py-2 border-b border-border">
          <dt className="text-fg-muted">Reset price</dt>
          <dd className="tnum text-accent font-semibold">{offer.price}</dd>
        </div>
        <div className="flex justify-between py-2 border-b border-border">
          <dt className="text-fg-muted">A new {offer.planLabel} account, discounted</dt>
          <dd className="tnum text-fg-subtle line-through">{offer.newAccountPrice}</dd>
        </div>
        {offer.resetCount > 0 && (
          <div className="flex justify-between py-2">
            <dt className="text-fg-muted">Previous resets</dt>
            <dd className="tnum">{offer.resetCount}</dd>
          </div>
        )}
      </dl>

      <div className="rounded-lg border border-border bg-surface-raised p-3 mb-4 text-xs text-fg-muted leading-relaxed space-y-1.5">
        <p className="text-fg font-medium">What a reset does not change</p>
        <p>
          &bull; Any lifetime payout capacity you have already used stays used. A reset does not
          give it back.
        </p>
        <p>&bull; Your payout history and signed documents are unchanged.</p>
        <p>&bull; Your platform sign-in stays the same.</p>
      </div>

      {offer.allowed ? (
        <form action={formAction}>
          <input type="hidden" name="tradingAccountId" value={offer.tradingAccountId} />
          <input type="hidden" name="idempotencyKey" value={offer.idempotencyKey} />
          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-lg bg-accent px-4 py-3 font-bold text-bg hover:bg-accent-strong disabled:opacity-40 transition-colors"
          >
            {pending ? 'Processing…' : `Reset for ${offer.price}`}
          </button>
          {offer.isDemo && (
            <p className="text-xs text-warn mt-2 text-center">
              Demonstration mode — no payment will be taken.
            </p>
          )}
        </form>
      ) : (
        <Callout tone="neutral">{offer.reason}</Callout>
      )}
    </Card>
  );
}
