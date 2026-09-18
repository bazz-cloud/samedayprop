import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { Badge, Callout, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Trading platform',
  description: 'Tradovate is the platform for every account, and the instruments you can trade on it.',
};

export const dynamic = 'force-dynamic';

/**
 * Platform page.
 *
 * Firms in this category give the platform its own page and list the tradeable
 * instruments. Ours does the same, and additionally names which instruments are
 * NOT yet enabled — the approved list is read live from the risk configuration,
 * so this page cannot drift from what the engine actually permits.
 */
export default async function PlatformPage() {
  const products = await prisma.productRiskConfig.findMany({ orderBy: { symbol: 'asc' } });
  const approved = products.filter((p) => p.approved);
  const pending = products.filter((p) => !p.approved);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-12">
      <header>
        <p className="text-accent font-medium text-sm uppercase tracking-wider">Platform</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">Tradovate</h1>
        <p className="mt-4 text-fg-muted max-w-3xl leading-relaxed">
          Tradovate is the platform for every account. There is no platform choice to make and no
          platform fee to add at checkout &mdash; access is included in the price of the account.
        </p>
      </header>

      <section aria-labelledby="access" className="space-y-4">
        <h2 id="access" className="text-2xl font-bold tracking-tight">
          Getting access
        </h2>
        <ol className="space-y-3">
          {[
            ['Buy an account', 'Your order is confirmed and your agreements are signed.'],
            [
              'We create your simulated account',
              'This happens in the background. Your dashboard shows truthful progress and never claims an account exists before it does.',
            ],
            [
              'We verify your limits',
              'Your position ceiling, daily loss limit and trailing threshold are applied and then read back from the platform. Trading is not enabled until they are confirmed.',
            ],
            [
              'You receive an invitation',
              'Access arrives as an invitation or a scoped token to your registered email address. We never email a reusable password and never store one in a form we could hand back to you.',
            ],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="shrink-0 h-7 w-7 rounded-full border border-accent/40 bg-accent-dim grid place-items-center text-accent text-xs font-semibold"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-fg-muted mt-1 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="instruments" className="space-y-4">
        <h2 id="instruments" className="text-2xl font-bold tracking-tight">
          Instruments you can trade
        </h2>
        <p className="text-fg-muted leading-relaxed">
          An instrument is tradeable only once its own risk controls are approved. We do not assume
          every futures contract carries the same dollar risk per contract, so an instrument that is
          not on this list cannot be traded at all rather than being silently treated like the ones
          that are.
        </p>

        <Card className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Approved instruments and their exposure weighting</caption>
            <thead>
              <tr className="border-b border-border text-left text-fg-subtle">
                <th scope="col" className="p-3 font-medium">Symbol</th>
                <th scope="col" className="p-3 font-medium">Contract</th>
                <th scope="col" className="p-3 font-medium text-right">Counts as</th>
                <th scope="col" className="p-3 font-medium">Netting group</th>
              </tr>
            </thead>
            <tbody>
              {approved.map((product) => (
                <tr key={product.symbol} className="border-b border-border last:border-0">
                  <td className="p-3 font-mono font-medium">{product.symbol}</td>
                  <td className="p-3 text-fg-muted">{product.description}</td>
                  <td className="p-3 text-right tnum">
                    {product.microEquivalentsPerContract} unit
                    {product.microEquivalentsPerContract === 1 ? '' : 's'}
                  </td>
                  <td className="p-3 text-fg-subtle text-xs font-mono">{product.nettingGroup}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>

        <p className="text-sm text-fg-subtle leading-relaxed">
          Your position ceiling is counted in these units. A mini counts as ten, a micro as one, so
          &ldquo;4 minis or 40 micros&rdquo; is a single combined limit of 40 units rather than two
          separate limits. Instruments in different netting groups are not offset against each other:
          being long the S&amp;P and short the Nasdaq is two positions worth of risk, not zero.
        </p>

        {pending.length > 0 && (
          <Callout tone="warn" title="Not yet enabled">
            <p className="mb-2">
              These instruments are recognised but cannot be traded until their product-specific risk
              controls are approved:
            </p>
            <ul className="space-y-1.5">
              {pending.map((product) => (
                <li key={product.symbol}>
                  <span className="font-mono font-medium">{product.symbol}</span> &mdash;{' '}
                  {product.description}
                </li>
              ))}
            </ul>
          </Callout>
        )}
      </section>

      <section aria-labelledby="status" className="space-y-4">
        <h2 id="status" className="text-2xl font-bold tracking-tight">
          Where this stands today
        </h2>
        <div className="flex flex-wrap gap-2 mb-2">
          <Badge tone="info">Depends on a third party</Badge>
        </div>
        <p className="text-fg-muted leading-relaxed">
          Tradovate is the planned platform. The partner capabilities this depends on &mdash;
          creating your account, applying and reading back your risk limits, streaming authoritative
          equity, and stopping trading when a limit is breached &mdash; have not yet been verified
          against a signed partner agreement. Until they are, accounts are provisioned in a clearly
          labelled simulation and the site says so on every page.
        </p>
        <p className="text-fg-muted leading-relaxed">
          We would rather tell you that now than discover it after you have paid.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/accounts"
          className="rounded-lg bg-accent px-6 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
        >
          Choose an account
        </Link>
        <Link
          href="/rules"
          className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent hover:text-accent transition-colors"
        >
          Read the rules
        </Link>
      </div>
    </div>
  );
}
