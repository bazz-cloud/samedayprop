'use client';

/**
 * Checkout signature and payment form.
 *
 * Two boxes, both unchecked by default — pre-ticking a consent box would make
 * the signature evidence worthless:
 *
 *   1. Agreement. One tick covers every required document, because they are
 *      served as one PDF with one signature block. The per-document evidence is
 *      unaffected: the PDF's first page lists each title, version and body hash,
 *      and the server still writes one acceptance row per document.
 *   2. Coupon. Applying or removing it re-quotes on the server, so the price is
 *      never computed in the browser.
 *
 * The signature is an affirmative action: the customer types their full legal
 * name, and submit stays disabled until the agreement is ticked and a name is
 * entered.
 */

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { completeCheckout, CONSENT_WORDING, type CheckoutActionState } from '@/app/checkout/actions';
import { Callout } from './ui';

export interface CheckoutDocument {
  id: string;
  slug: string;
  title: string;
  isDraft: boolean;
}

const INITIAL: CheckoutActionState = { error: null, fieldErrors: {} };

export function CheckoutForm({
  quoteId,
  idempotencyKey,
  documents,
  suggestedName,
  totalDisplay,
  isDemo,
  coupon,
}: {
  quoteId: string;
  idempotencyKey: string;
  documents: CheckoutDocument[];
  suggestedName: string;
  totalDisplay: string;
  isDemo: boolean;
  coupon: {
    code: string;
    percentOff: number;
    applied: boolean;
    /** Where to go to toggle it. The server re-quotes from this URL. */
    toggleHref: string;
    savingDisplay: string | null;
    rejection: string | null;
  };
}) {
  const [state, formAction, pending] = useActionState(completeCheckout, INITIAL);
  const [agreed, setAgreed] = useState(false);
  const [typedName, setTypedName] = useState(suggestedName);

  const canSubmit = agreed && typedName.trim().length >= 2 && !pending;
  const draftCount = documents.filter((d) => d.isDraft).length;
  const pdfHref = `/api/checkout/agreement?quoteId=${encodeURIComponent(quoteId)}`;

  return (
    <div className="space-y-4">
      {/* ---- box 2: the coupon ------------------------------------------- */}
      {/* Its own form: toggling re-quotes on the server via a GET, so the
          discount can never be decided in the browser. */}
      <form method="get" action="/checkout" className="rounded-xl border border-border bg-surface p-4">
        <ToggleFields href={coupon.toggleHref} />
        <div className="flex items-start gap-3">
          <input
            id="applyCoupon"
            type="checkbox"
            checked={coupon.applied}
            onChange={(event) => event.currentTarget.form?.requestSubmit()}
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
          />
          <div className="min-w-0 flex-1">
            <label htmlFor="applyCoupon" className="no-caps font-bold cursor-pointer">
              Apply discount code{' '}
              <span className={coupon.applied ? 'coupon-chip is-on' : 'coupon-chip'}>
                {coupon.code}
              </span>
            </label>
            <p className="no-caps text-sm text-fg-muted mt-1">
              {coupon.applied && coupon.savingDisplay
                ? `${coupon.percentOff}% off — you save ${coupon.savingDisplay}.`
                : `${coupon.percentOff}% off your account and every eligible extra.`}
            </p>
            {coupon.rejection && (
              <p className="no-caps text-sm text-fg mt-1">{coupon.rejection}</p>
            )}
          </div>
        </div>
      </form>

      {/* ---- box 1: the agreement ---------------------------------------- */}
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="agreedToAll" value={agreed ? 'on' : ''} />

        {state.error && (
          <div role="alert">
            <Callout tone="danger" title="We could not complete your purchase">
              {state.error}
            </Callout>
          </div>
        )}

        <div className="rounded-xl border border-border bg-surface p-4">
          <div className="flex items-start gap-3">
            <input
              id="agreedToAll"
              type="checkbox"
              checked={agreed}
              onChange={(event) => setAgreed(event.target.checked)}
              aria-describedby="agreement-help"
              className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
            />
            <div className="min-w-0 flex-1">
              <label htmlFor="agreedToAll" className="no-caps font-bold cursor-pointer">
                I have read and agree to the trader agreement and all related terms
              </label>
              <p id="agreement-help" className="no-caps text-sm text-fg-muted mt-1">
                {documents.length} documents in one PDF, each identified by version and hash.
              </p>
              <div className="flex flex-wrap gap-3 mt-2 text-sm">
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noreferrer"
                  className="no-caps text-accent hover:underline font-medium"
                >
                  Read the PDF &rarr;
                </a>
                <a href={`${pdfHref}&download=1`} download className="no-caps text-fg-subtle hover:text-fg">
                  Download
                </a>
              </div>
              {draftCount > 0 && (
                <p className="no-caps text-xs text-fg-subtle mt-2">
                  {draftCount} of these are drafts pending legal review, and are marked as such in
                  the PDF.
                </p>
              )}
              {state.fieldErrors.agreedToAll && (
                <p className="no-caps text-sm text-fg font-bold mt-2">
                  {state.fieldErrors.agreedToAll}
                </p>
              )}
            </div>
          </div>

          {/* The e-signature, at the bottom of what it signs. */}
          <div className="mt-4 border-t border-border pt-4">
            <p className="no-caps text-sm text-fg-muted leading-relaxed">{CONSENT_WORDING}</p>
            <label htmlFor="typedLegalName" className="no-caps block text-sm font-bold mt-3 mb-1">
              Sign by typing your full legal name
            </label>
            <input
              id="typedLegalName"
              name="typedLegalName"
              value={typedName}
              onChange={(event) => setTypedName(event.target.value)}
              autoComplete="name"
              required
              minLength={2}
              aria-describedby="signature-help"
              className="w-full rounded-lg border border-border bg-bg px-3 py-2.5 text-lg focus:border-accent"
            />
            <p id="signature-help" className="no-caps text-xs text-fg-subtle mt-1.5">
              We record your typed name, the exact documents and price you agreed to, the time, and
              limited technical evidence. You can download everything you signed at any time.
            </p>
            {state.fieldErrors.typedLegalName && (
              <p className="no-caps text-sm text-fg font-bold mt-1">
                {state.fieldErrors.typedLegalName}
              </p>
            )}
          </div>
        </div>

        <Callout tone="neutral">
          Ticking a box and typing your name creates a record of agreement. It does not by itself
          guarantee that every term is enforceable — that depends on the governing law, which has not
          yet been decided, and on a legal review that has not yet happened.
        </Callout>

        <div className="rounded-xl border border-border bg-surface p-4">
          <h3 className="text-sm">Payment</h3>
          {isDemo ? (
            <p className="no-caps text-sm text-fg mt-2 leading-relaxed">
              Demonstration mode. No payment provider is connected, no card details are collected and
              no money will move. Submitting records a simulated payment so the rest of the flow can
              be tested.
            </p>
          ) : (
            <p className="no-caps text-sm text-fg-muted mt-2 leading-relaxed">
              You will be taken to our payment provider&apos;s hosted page to enter your card
              details. Card details are never entered on or stored by this site.
            </p>
          )}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className="no-caps w-full rounded-lg bg-accent px-4 py-3.5 font-bold text-bg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {pending ? 'Processing…' : `Sign and pay ${totalDisplay}`}
        </button>

        <p aria-live="polite" className="no-caps text-xs text-fg-subtle text-center">
          {!agreed
            ? 'Tick the agreement to continue.'
            : typedName.trim().length < 2
              ? 'Type your full legal name to continue.'
              : 'One-time charge. Nothing renews automatically.'}
        </p>
      </form>

      <p className="no-caps text-xs text-fg-subtle">
        Prefer to read them separately? Every document is also on the{' '}
        <Link href="/legal/trader-agreement" className="text-accent hover:underline">
          legal pages
        </Link>
        .
      </p>
    </div>
  );
}

/**
 * The coupon toggle target, expressed as hidden fields.
 *
 * A GET form serialises its own fields rather than keeping the action's query
 * string, so the destination has to be rebuilt here.
 */
function ToggleFields({ href }: { href: string }) {
  const params = new URLSearchParams(href.split('?')[1] ?? '');
  return (
    <>
      {[...params.entries()].map(([key, value], index) => (
        <input key={`${key}-${index}`} type="hidden" name={key} value={value} />
      ))}
    </>
  );
}
