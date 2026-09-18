'use client';

/**
 * Platform credentials banner.
 *
 * Sits under the site banners while signed in, on every page, so a trader can
 * always find their platform sign-in.
 *
 * The username shows permanently — it is not a secret. The password shows only
 * until the trader confirms they have saved it, because after that point we
 * keep nothing but a hash. That is deliberate: a password we can redisplay is a
 * password a database leak hands to an attacker, and we have no need to hold
 * one. Losing it re-issues a new one rather than recovering the old.
 */

import { useActionState, useState } from 'react';
import {
  requestCredentialReissue,
  saveCredentialAcknowledgement,
  type CredentialActionState,
} from '@/app/dashboard/credential-actions';

const INITIAL: CredentialActionState = { error: null, newPassword: null };

export interface CredentialBannerData {
  tradingAccountId: string;
  accountLabel: string;
  username: string;
  password: string | null;
  acknowledged: boolean;
  mustChangeOnFirstUse: boolean;
  isDemo: boolean;
}

function CopyField({ label, value, secret = false }: { label: string; value: string; secret?: boolean }) {
  const [copied, setCopied] = useState(false);
  const [shown, setShown] = useState(!secret);

  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-fg-subtle shrink-0">{label}</span>
      <code className="font-mono text-fg bg-surface-raised border border-border rounded px-2 py-0.5 truncate">
        {shown ? value : '•'.repeat(Math.min(value.length, 20))}
      </code>
      {secret && (
        <button
          type="button"
          onClick={() => setShown((v) => !v)}
          className="shrink-0 text-fg-subtle hover:text-fg underline text-xs"
        >
          {shown ? 'Hide' : 'Show'}
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(
            () => { setCopied(true); setTimeout(() => setCopied(false), 1800); },
            () => setCopied(false),
          );
        }}
        className="shrink-0 text-accent hover:underline text-xs"
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
    </div>
  );
}

export function CredentialsBanner({ data }: { data: CredentialBannerData }) {
  const [ackState, ackAction, ackPending] = useActionState(saveCredentialAcknowledgement, INITIAL);
  const [reissueState, reissueAction, reissuePending] = useActionState(requestCredentialReissue, INITIAL);

  // A re-issue returns the new password once; it is never read back afterwards.
  const password = reissueState.newPassword ?? data.password;
  const unsaved = Boolean(password);

  return (
    <div className={`border-b ${unsaved ? 'border-accent/40 bg-accent-dim/30' : 'border-border bg-surface'}`}>
      <div className="mx-auto max-w-7xl px-4 py-2 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
        <span className="font-bold shrink-0">
          Platform sign-in
          <span className="text-fg-subtle font-normal"> · {data.accountLabel}</span>
        </span>

        <CopyField label="User" value={data.username} />

        {password ? (
          <>
            <CopyField label="Password" value={password} secret />
            <form action={ackAction} className="shrink-0">
              <input type="hidden" name="tradingAccountId" value={data.tradingAccountId} />
              <button
                type="submit"
                disabled={ackPending}
                className="rounded-md bg-accent px-3 py-1 text-xs font-bold text-bg hover:bg-accent-strong disabled:opacity-50"
              >
                {ackPending ? 'Saving…' : "I've saved it"}
              </button>
            </form>
            <span className="text-xs text-accent">
              Shown once. After you confirm, we keep only a hash and cannot show it again.
            </span>
          </>
        ) : (
          <>
            <span className="text-xs text-fg-subtle">
              Password saved. We store only a hash, so it cannot be displayed again.
            </span>
            <form action={reissueAction} className="shrink-0">
              <input type="hidden" name="tradingAccountId" value={data.tradingAccountId} />
              <button
                type="submit"
                disabled={reissuePending}
                className="rounded-md border border-border-strong px-3 py-1 text-xs font-medium hover:border-accent hover:text-accent disabled:opacity-50"
              >
                {reissuePending ? 'Issuing…' : 'Issue a new password'}
              </button>
            </form>
          </>
        )}

        {data.isDemo && (
          <span className="text-xs text-warn shrink-0">
            Demo credentials — no real platform account exists.
          </span>
        )}
        {(ackState.error ?? reissueState.error) && (
          <span className="text-xs text-danger">{ackState.error ?? reissueState.error}</span>
        )}
      </div>
    </div>
  );
}
