'use client';

/**
 * Checkout signature and payment form.
 *
 * Acknowledgements start UNCHECKED — pre-ticking a consent box would make the
 * signature evidence worthless. The signature is an affirmative action: the
 * customer types their full legal name, and the submit button stays disabled
 * until every document is acknowledged and a name is entered.
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
  excerpt: string;
}

const INITIAL: CheckoutActionState = { error: null, fieldErrors: {} };

export function CheckoutForm({
  quoteId,
  idempotencyKey,
  documents,
  suggestedName,
  totalDisplay,
  isDemo,
}: {
  quoteId: string;
  idempotencyKey: string;
  documents: CheckoutDocument[];
  suggestedName: string;
  totalDisplay: string;
  isDemo: boolean;
}) {
  const [state, formAction, pending] = useActionState(completeCheckout, INITIAL);
  const [acknowledged, setAcknowledged] = useState<Record<string, boolean>>({});
  const [typedName, setTypedName] = useState(suggestedName);
  const [expanded, setExpanded] = useState<string | null>(null);

  const allAcknowledged = documents.every((d) => acknowledged[d.id]);
  const canSubmit = allAcknowledged && typedName.trim().length >= 2 && !pending;

  return (
    <form action={formAction} className="space-y-6">
      <input type="hidden" name="quoteId" value={quoteId} />
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      {state.error && (
        <div role="alert">
          <Callout tone="danger" title="We could not complete your purchase">
            {state.error}
          </Callout>
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="font-semibold mb-2">
          Agreements ({documents.filter((d) => acknowledged[d.id]).length}/{documents.length}{' '}
          acknowledged)
        </legend>

        {documents.map((document) => (
          <div key={document.id} className="rounded-lg border border-border bg-surface p-4">
            <div className="flex items-start gap-3">
              <input
                id={`ack_${document.id}`}
                name={`ack_${document.id}`}
                type="checkbox"
                checked={acknowledged[document.id] ?? false}
                onChange={(event) =>
                  setAcknowledged((current) => ({
                    ...current,
                    [document.id]: event.target.checked,
                  }))
                }
                aria-describedby={`desc_${document.id}`}
                className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-accent)]"
              />
              <div className="min-w-0 flex-1">
                <label htmlFor={`ack_${document.id}`} className="font-medium cursor-pointer">
                  {document.title}
                </label>
                {document.isDraft && (
                  <p className="text-xs text-warn mt-1">
                    Draft pending legal review — not yet approved by a lawyer.
                  </p>
                )}
                <p id={`desc_${document.id}`} className="text-sm text-fg-muted mt-1">
                  {document.excerpt}
                </p>
                <div className="flex gap-3 mt-2 text-sm">
                  <button
                    type="button"
                    onClick={() =>
                      setExpanded((current) => (current === document.id ? null : document.id))
                    }
                    aria-expanded={expanded === document.id}
                    className="text-accent hover:underline"
                  >
                    {expanded === document.id ? 'Hide full text' : 'Read full text'}
                  </button>
                  <Link
                    href={`/legal/${document.slug}`}
                    target="_blank"
                    className="text-fg-subtle hover:text-fg"
                  >
                    Open in a new tab
                  </Link>
                </div>
                {expanded === document.id && (
                  <div className="mt-3 max-h-80 overflow-y-auto rounded border border-border bg-bg p-3">
                    <pre className="whitespace-pre-wrap font-sans text-xs text-fg-muted leading-relaxed">
                      {document.excerpt}
                    </pre>
                    <p className="text-xs text-fg-subtle mt-3 border-t border-border pt-2">
                      This is the opening of the document.{' '}
                      <Link
                        href={`/legal/${document.slug}`}
                        target="_blank"
                        className="text-accent hover:underline"
                      >
                        Read the complete text
                      </Link>
                      .
                    </p>
                  </div>
                )}
                {state.fieldErrors[`ack_${document.id}`] && (
                  <p className="text-sm text-danger mt-2">
                    {state.fieldErrors[`ack_${document.id}`]}
                  </p>
                )}
              </div>
            </div>
          </div>
        ))}
      </fieldset>

      <div className="rounded-lg border border-border-strong bg-surface-raised p-4">
        <p className="text-sm text-fg-muted leading-relaxed">{CONSENT_WORDING}</p>
        <div className="mt-4">
          <label htmlFor="typedLegalName" className="block text-sm font-medium mb-1">
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
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
          />
          <p id="signature-help" className="text-xs text-fg-subtle mt-1">
            We record your typed name, the exact documents and price you agreed to, the time, and
            limited technical evidence. You can download everything you signed at any time.
          </p>
          {state.fieldErrors.typedLegalName && (
            <p className="text-sm text-danger mt-1">{state.fieldErrors.typedLegalName}</p>
          )}
        </div>
      </div>

      <Callout tone="neutral">
        Ticking a box and typing your name creates a record of agreement. It does not by itself
        guarantee that every term is enforceable — that depends on the governing law, which has not
        yet been decided, and on a legal review that has not yet happened.
      </Callout>

      <div className="rounded-lg border border-border bg-surface p-4">
        <h3 className="font-semibold">Payment</h3>
        {isDemo ? (
          <p className="text-sm text-warn mt-2 leading-relaxed">
            Demonstration mode. No payment provider is connected, no card details are collected and
            no money will move. Submitting records a simulated payment so the rest of the flow can
            be tested.
          </p>
        ) : (
          <p className="text-sm text-fg-muted mt-2 leading-relaxed">
            You will be taken to our payment provider&apos;s hosted page to enter your card
            details. Card details are never entered on or stored by this site.
          </p>
        )}
      </div>

      <button
        type="submit"
        disabled={!canSubmit}
        className="w-full rounded-lg bg-accent px-4 py-3.5 font-semibold text-bg hover:bg-accent-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {pending ? 'Processing…' : `Sign and pay ${totalDisplay}`}
      </button>

      <p aria-live="polite" className="text-xs text-fg-subtle text-center">
        {!allAcknowledged
          ? 'Acknowledge every agreement to continue.'
          : typedName.trim().length < 2
            ? 'Type your full legal name to continue.'
            : 'One-time charge. Nothing renews automatically.'}
      </p>
    </form>
  );
}
