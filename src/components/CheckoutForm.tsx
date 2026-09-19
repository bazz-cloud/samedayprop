'use client';

/**
 * Checkout signature and payment form.
 *
 * The agreement box is unchecked by default — pre-ticking a consent box would
 * make the signature evidence worthless. One tick covers every required
 * document, because they are served as one PDF with one signature block. The
 * per-document evidence is unaffected: the PDF's first page lists each title,
 * version and body hash, and the server still writes one acceptance row per
 * document.
 *
 * The signature is an affirmative action: the customer types their full legal
 * name, and submit stays disabled until the agreement is ticked and a name is
 * entered.
 *
 * The promo field lives in the order summary beside the total it changes, not
 * in here. It re-quotes on the server either way, so the price is never
 * computed in the browser.
 */

import { useActionState, useState } from 'react';
import Link from 'next/link';
import { completeCheckout, type CheckoutActionState } from '@/app/checkout/actions';
import { CONSENT_WORDING } from '@/app/checkout/consent';
import { Callout } from './ui';

export interface CheckoutPlatform {
  key: string;
  name: string;
  summary: string;
  note: string;
  /** False when this application cannot provision on it by itself. */
  reachable: boolean;
}

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
  platforms,
  defaultPlatform,
  suggestedName,
  totalDisplay,
  isDemo,
}: {
  quoteId: string;
  idempotencyKey: string;
  documents: CheckoutDocument[];
  platforms: CheckoutPlatform[];
  defaultPlatform: string;
  suggestedName: string;
  totalDisplay: string;
  isDemo: boolean;
}) {
  const [state, formAction, pending] = useActionState(completeCheckout, INITIAL);
  const [agreed, setAgreed] = useState(false);
  const [platform, setPlatform] = useState(defaultPlatform);
  const [typedName, setTypedName] = useState(suggestedName);

  const canSubmit = agreed && typedName.trim().length >= 2 && !pending;
  const draftCount = documents.filter((d) => d.isDraft).length;
  const pdfHref = `/api/checkout/agreement?quoteId=${encodeURIComponent(quoteId)}`;

  return (
    <div className="space-y-4">
      <form action={formAction} className="space-y-5">
        <input type="hidden" name="quoteId" value={quoteId} />
        <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
        <input type="hidden" name="agreedToAll" value={agreed ? 'on' : ''} />
        <input type="hidden" name="platform" value={platform} />

        {/* The platform choice sits INSIDE the signed form, so the record of
            what was agreed includes which platform it was agreed for. It is
            also above the signature rather than below it, because it is part of
            the thing being signed. */}
        <fieldset className="rounded-xl border border-border bg-surface p-4">
          <legend className="label px-1">Trading platform</legend>
          <div className="mt-2 grid gap-2.5 sm:grid-cols-2">
            {platforms.map((option) => {
              const selected = option.key === platform;
              return (
                <label
                  key={option.key}
                  className={`block cursor-pointer rounded-lg border p-3.5 transition-colors ${
                    selected
                      ? 'border-accent bg-card-accent'
                      : 'border-border bg-card hover:border-border-bold'
                  }`}
                >
                  <div className="flex items-start gap-2.5">
                    <input
                      type="radio"
                      name="platformChoice"
                      value={option.key}
                      checked={selected}
                      onChange={() => setPlatform(option.key)}
                      className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0">
                      <span className="no-caps font-bold">{option.name}</span>
                      <p className="no-caps mt-0.5 text-xs text-fg-muted leading-relaxed">
                        {option.summary}
                      </p>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>
          {/* The chosen platform's caveat, always visible rather than on hover:
              this choice is made once and is awkward to undo. */}
          <p className="no-caps mt-3 text-xs text-fg-subtle leading-relaxed">
            {platforms.find((option) => option.key === platform)?.note}
          </p>
        </fieldset>

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

              {/* The documents in the bundle, each with its state. One signature
                  covers all of them, so the state is shared — showing per-document
                  badges that always move together would imply a choice there is
                  not one of. */}
              <ul className="mt-3 space-y-1.5">
                {documents.map((document) => (
                  <li key={document.id} className="flex items-center justify-between gap-3">
                    <span className="no-caps text-sm text-fg-muted">{document.title}</span>
                    <span
                      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                        agreed
                          ? 'border-accent text-accent'
                          : 'border-border-bold text-fg-disabled'
                      }`}
                    >
                      {agreed ? 'Signed' : 'Read & sign'}
                    </span>
                  </li>
                ))}
              </ul>

              <div className="flex flex-wrap gap-3 mt-3 text-sm">
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

        {/* Styled as a payment-method block because that is what it is, but with
            no card-brand marks: no payment provider is connected, and a row of
            network logos would be the one piece of theatre on this page. */}
        <div className="rounded-xl border border-border bg-surface overflow-hidden">
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
            <h3 className="label">Payment method</h3>
            <span
              className={`shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                isDemo ? 'border-border-bold text-fg-subtle' : 'border-accent text-accent'
              }`}
            >
              {isDemo ? 'Demonstration' : 'Hosted page'}
            </span>
          </div>
          <div className="flex items-start gap-3 p-4">
            <LockIcon />
            {isDemo ? (
              <p className="no-caps text-sm text-fg leading-relaxed">
                Demonstration mode. No payment provider is connected, no card details are collected and
                no money will move. Submitting records a simulated payment so the rest of the flow can
                be tested.
              </p>
            ) : (
              <p className="no-caps text-sm text-fg-muted leading-relaxed">
                You will be taken to our payment provider&apos;s hosted page to enter your card
                details. Card details are never entered on or stored by this site.
              </p>
            )}
          </div>
        </div>

        <div className="rounded-xl border border-border-strong bg-card-danger p-4">
          <p className="no-caps text-sm leading-relaxed">
            This is a simulated account. You can breach a limit, lose access and lose this fee. Most
            participants in programs of this kind do not receive a payout.
          </p>
        </div>

        {/* Disabled, never hidden, with the reason written on the button itself.
            A button that vanishes leaves someone hunting for what they missed. */}
        <button
          type="submit"
          disabled={!canSubmit}
          className="no-caps w-full rounded-[9px] bg-accent px-4 py-3.5 text-base font-bold text-black hover:bg-accent-strong disabled:cursor-not-allowed disabled:bg-transparent disabled:text-fg-subtle disabled:border disabled:border-dashed disabled:border-border-bold transition-colors"
        >
          {pending
            ? 'Processing…'
            : !agreed
              ? 'Agree to the terms to pay'
              : typedName.trim().length < 2
                ? 'Sign with your full legal name to pay'
                : `Sign and pay ${totalDisplay}`}
        </button>

        <p aria-live="polite" className="sr-only">
          {!agreed
            ? 'Tick the agreement to continue.'
            : typedName.trim().length < 2
              ? 'Type your full legal name to continue.'
              : 'Ready to pay.'}
        </p>

        <ul className="grid gap-2 sm:grid-cols-3">
          {[
            'Account live within minutes of payment',
            'Nothing renews, and no card is kept on file',
            'Rules are enforced on our servers, not by manual review',
          ].map((point) => (
            <li
              key={point}
              className="no-caps flex gap-2 rounded-lg border border-border bg-surface px-3 py-2.5 text-xs text-fg-muted leading-relaxed"
            >
              <span aria-hidden="true" className="text-accent shrink-0">
                ✓
              </span>
              {point}
            </li>
          ))}
        </ul>
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

/** A padlock, inline. No icon package, no remote asset. */
function LockIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="mt-0.5 h-4 w-4 shrink-0 text-accent"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="4" y="10" width="16" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </svg>
  );
}
