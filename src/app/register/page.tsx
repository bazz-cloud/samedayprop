import Link from 'next/link';
import type { Metadata } from 'next';
import { Callout } from '@/components/ui';

export const metadata: Metadata = { title: 'Create an account' };

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const next = typeof params.next === 'string' ? params.next : null;

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Create your account</h1>
      <p className="mt-2 text-sm text-fg-muted">
        Creating an account is free. You choose and pay for a simulated account separately.
      </p>

      {error && (
        <div className="mt-4" role="alert">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}

      <form action="/api/auth/register" method="post" className="mt-6 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
        <div>
          <label htmlFor="legalName" className="block text-sm font-medium mb-1">
            Full legal name
          </label>
          <input
            id="legalName"
            name="legalName"
            autoComplete="name"
            required
            minLength={2}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
          />
          <p className="text-xs text-fg-subtle mt-1">
            This is the name you will use to sign the agreements at checkout.
          </p>
        </div>
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            required
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
          />
        </div>
        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            minLength={12}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
          />
          <p className="text-xs text-fg-subtle mt-1">
            At least 12 characters. Length matters far more than symbols, so a passphrase is fine.
          </p>
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
        >
          Create account
        </button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        Already registered?{' '}
        <Link href="/login" className="text-accent hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}
