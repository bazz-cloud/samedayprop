import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/server/db';
import { Chip, SpecTable } from '@/components/system';

export const metadata: Metadata = {
  title: 'Trading platform',
  description: 'Tradovate is the platform for every account, and the instruments you can trade on it.',
};

export const dynamic = 'force-dynamic';

/**
 * Platform.
 *
 * The shortest page on the site: what you get, how you sign in, what you can
 * trade. The approved instrument list is read live from the risk configuration,
 * so this page cannot drift from what the engine actually permits.
 */
export default async function PlatformPage() {
  const products = await prisma.productRiskConfig.findMany({ orderBy: { symbol: 'asc' } });
  const approved = products.filter((p) => p.approved);
  const pending = products.filter((p) => !p.approved);

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-10">
      <header>
        <h1 className="text-3xl sm:text-4xl">Tradovate</h1>
        <p className="no-caps mt-3 text-xl font-bold leading-snug">
          One platform, included in the price. No platform fee.
        </p>
      </header>

      <section aria-labelledby="access" className="space-y-4">
        <h2 id="access" className="text-2xl">
          How you get in
        </h2>
        <SpecTable
          caption="Steps between buying an account and trading it"
          columns={[
            { key: 'step', label: 'Step' },
            { key: 'what', label: 'What happens' },
          ]}
          rows={[
            { step: '1', what: 'You buy an account and sign your agreements.' },
            { step: '2', what: 'We create your simulated account in the background.' },
            {
              step: '3',
              what: 'We apply your limits and read them back. Trading stays off until they confirm.',
            },
            {
              step: '4',
              what: 'An invitation arrives at your registered email address.',
            },
          ]}
        />
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          We never email a reusable password, and never store one in a form we could hand back to
          you.
        </p>
      </section>

      <section aria-labelledby="instruments" className="space-y-4">
        <h2 id="instruments" className="text-2xl">
          What you can trade
        </h2>
        <p className="no-caps font-bold text-lg">
          If it is not on this list, you cannot trade it.
        </p>
        <div className="overflow-x-auto">
          <div className="min-w-[34rem]">
            <SpecTable
              caption="Approved instruments and their exposure weighting"
              columns={[
                { key: 'symbol', label: 'Symbol' },
                { key: 'contract', label: 'Contract' },
                { key: 'counts', label: 'Counts as', numeric: true },
                { key: 'group', label: 'Netting group' },
              ]}
              rows={approved.map((product) => ({
                symbol: <span className="font-mono">{product.symbol}</span>,
                contract: <span className="no-caps text-fg-muted">{product.description}</span>,
                counts: `${product.microEquivalentsPerContract} unit${
                  product.microEquivalentsPerContract === 1 ? '' : 's'
                }`,
                group: <span className="font-mono text-xs text-fg-subtle">{product.nettingGroup}</span>,
              }))}
            />
          </div>
        </div>
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          Different netting groups are not offset against each other: long the S&amp;P and short the
          Nasdaq is two positions of risk, not zero.
        </p>

        {pending.length > 0 && (
          <div className="rounded-xl border border-border-strong bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="no-caps text-sm font-bold">Recognised, not yet enabled</p>
              <Chip status="UNRESOLVED" />
            </div>
            <ul className="no-caps mt-2 space-y-1 text-sm text-fg-muted">
              {pending.map((product) => (
                <li key={product.symbol}>
                  <span className="font-mono">{product.symbol}</span> — {product.description}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section aria-labelledby="status" className="space-y-3">
        <h2 id="status" className="text-2xl">
          Where this stands
        </h2>
        <div className="flex flex-wrap items-center gap-2">
          <p className="no-caps font-bold text-lg">Tradovate is planned, not yet verified.</p>
          <Chip status="EXTERNAL" />
        </div>
        <p className="no-caps text-fg-muted leading-relaxed">
          Creating your account, applying and reading back your limits, streaming authoritative
          equity and stopping trading on a breach all depend on partner capabilities we have not yet
          verified against a signed agreement. Until then accounts are provisioned in a clearly
          labelled simulation.
        </p>
      </section>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/accounts"
          className="no-caps rounded-lg bg-accent px-6 py-3 font-bold text-bg hover:bg-accent-strong transition-colors"
        >
          Choose an account
        </Link>
        <Link
          href="/rules"
          className="no-caps rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent hover:text-accent transition-colors"
        >
          Read the rules
        </Link>
      </div>
    </div>
  );
}
