import Link from 'next/link';
import type { Metadata } from 'next';
import { getConfig } from '@/server/config';
import { Callout } from '@/components/ui';

export const metadata: Metadata = { title: 'Sign in' };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const error = typeof params.error === 'string' ? params.error : null;
  const notice = typeof params.notice === 'string' ? params.notice : null;
  const next = typeof params.next === 'string' ? params.next : null;
  const config = getConfig();

  return (
    <div className="mx-auto max-w-md px-4 py-16">
      <h1 className="text-2xl font-bold tracking-tight">Sign in</h1>

      {error && (
        <div className="mt-4" role="alert">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      {notice && (
        <div className="mt-4" role="status">
          <Callout tone="info">{notice}</Callout>
        </div>
      )}

      <form action="/api/auth/login" method="post" className="mt-6 space-y-4">
        {next && <input type="hidden" name="next" value={next} />}
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
            autoComplete="current-password"
            required
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 focus:border-accent"
          />
        </div>
        <button
          type="submit"
          className="w-full rounded-lg bg-accent px-4 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
        >
          Sign in
        </button>
      </form>

      <p className="mt-4 text-sm text-fg-muted">
        No account yet?{' '}
        <Link href="/register" className="text-accent hover:underline">
          Create one
        </Link>
      </p>
      <p className="mt-2 text-sm text-fg-subtle">
        Password reset requires a configured email provider, which is not set up in this
        environment. Contact support to regain access.
      </p>

      {config.isDemo && (
        <div className="mt-8">
          <Callout tone="warn" title="Demo accounts">
            <p className="mb-2">Every seeded account uses the password below.</p>
            <ul className="font-mono text-xs space-y-0.5">
              <li>owner@example.invalid — owner dashboard</li>
              <li>trader.eligible@example.invalid — payout available</li>
              <li>trader.breached@example.invalid — breached account</li>
              <li>trader.stale@example.invalid — stale data</li>
            </ul>
            <p className="font-mono text-xs mt-2">demo-password-not-secret</p>
          </Callout>
        </div>
      )}
    </div>
  );
}
