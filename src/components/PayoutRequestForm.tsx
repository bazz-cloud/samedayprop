'use client';

import { useActionState, useState } from 'react';
import { submitPayoutRequest, type PayoutActionState } from '@/app/dashboard/actions';
import { Callout } from './ui';

const INITIAL: PayoutActionState = { error: null, success: null };

/**
 * Payout request form.
 *
 * Shows the cash figure alongside the gross as the trader types, so the 50/50
 * split is never a surprise at the end. The preview is a display convenience —
 * the server recomputes and validates the whole thing independently.
 */
export function PayoutRequestForm({
  tradingAccountId,
  maxGrossDecimal,
  maxGrossDisplay,
  maxCashDisplay,
  minimumGrossDecimal,
  idempotencyKey,
}: {
  tradingAccountId: string;
  maxGrossDecimal: string;
  maxGrossDisplay: string;
  maxCashDisplay: string;
  minimumGrossDecimal: string;
  idempotencyKey: string;
}) {
  const [state, formAction, pending] = useActionState(submitPayoutRequest, INITIAL);
  const [gross, setGross] = useState(minimumGrossDecimal);

  const grossNumber = Number(gross);
  const valid =
    Number.isFinite(grossNumber) &&
    Number.isInteger(grossNumber) &&
    grossNumber >= Number(minimumGrossDecimal) &&
    grossNumber <= Number(maxGrossDecimal);

  const cashPreview = valid
    ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(grossNumber / 2)
    : '—';

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="tradingAccountId" value={tradingAccountId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error && (
        <div role="alert">
          <Callout tone="danger">{state.error}</Callout>
        </div>
      )}
      {state.success && (
        <div role="status">
          <Callout tone="accent">{state.success}</Callout>
        </div>
      )}

      <div>
        <label htmlFor="gross" className="block text-sm font-medium mb-1">
          Gross withdrawal
        </label>
        <div className="flex items-center gap-2">
          <span aria-hidden="true" className="text-fg-subtle">
            $
          </span>
          <input
            id="gross"
            name="gross"
            type="number"
            step="1"
            min={minimumGrossDecimal}
            max={maxGrossDecimal}
            value={gross}
            onChange={(event) => setGross(event.target.value)}
            aria-describedby="gross-help"
            className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 tnum focus:border-accent"
          />
        </div>
        <p id="gross-help" className="text-xs text-fg-subtle mt-1">
          Whole dollars, between ${minimumGrossDecimal} and {maxGrossDisplay}. The maximum right now
          pays {maxCashDisplay} in cash.
        </p>
      </div>

      <div className="rounded-lg border border-accent/30 bg-accent-dim/20 p-3" aria-live="polite">
        <div className="flex justify-between text-sm">
          <span className="text-fg-muted">Deducted from your simulated account</span>
          <span className="tnum">{valid ? `$${grossNumber.toFixed(2)}` : '—'}</span>
        </div>
        <div className="flex justify-between text-sm mt-1">
          <span className="text-fg-muted">Paid to you in real cash</span>
          <span className="tnum text-accent font-semibold">{cashPreview}</span>
        </div>
        <p className="text-xs text-fg-subtle mt-2">
          The other half is not paid to anyone. It is simulated balance that ceases to exist.
        </p>
      </div>

      <button
        type="submit"
        disabled={!valid || pending}
        className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-bg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? 'Submitting…' : 'Request payout'}
      </button>
    </form>
  );
}
