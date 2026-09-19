import type { Metadata } from 'next';
import Link from 'next/link';
import { getConfig } from '@/server/config';
import { Chip, DisclosureBlock, SpecTable } from '@/components/system';

export const metadata: Metadata = {
  title: 'About',
  description: 'What this program is, how it differs from the rest of the category, and what we do not claim.',
};

/**
 * About.
 *
 * Under 100 words of prose. The comparison table carries the argument, and the
 * claims we decline to make sit in a disclosure block, which is never
 * compressed — they are the substance of the page, not padding around it.
 */
export default function AboutPage() {
  const config = getConfig();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-10">
      <header>
        <h1 className="text-3xl sm:text-4xl">About</h1>
        <p className="no-caps mt-3 text-xl font-bold leading-snug">
          No evaluation, no monthly fee, no consistency rule. A 50% split instead.
        </p>
      </header>

      <section aria-labelledby="difference" className="space-y-4">
        <h2 id="difference" className="text-2xl">
          How this differs
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[34rem]">
            <SpecTable
              caption="Common category terms compared with ours"
              columns={[
                { key: 'term', label: 'Term' },
                { key: 'theirs', label: 'Common in this category' },
                { key: 'ours', label: 'Here' },
              ]}
              rows={[
                {
                  term: 'Getting funded',
                  theirs: 'Pass an evaluation with a profit target',
                  ours: 'Buy the account and trade it',
                },
                {
                  term: 'Cost',
                  theirs: 'Monthly subscription, often an activation fee',
                  ours: 'One-time purchase',
                },
                {
                  term: 'Drawdown',
                  theirs: 'Often end-of-day trailing',
                  ours: 'Intraday trailing, following unrealized equity',
                },
                {
                  term: 'Consistency rule',
                  theirs: 'Commonly a 20–40% best-day cap at payout',
                  ours: 'None',
                },
                {
                  term: 'Minimum trading days',
                  theirs: 'Commonly required before a first payout',
                  ours: 'None. Day one is eligible.',
                },
                { term: 'Profit split', theirs: 'Typically 80–90% to the trader', ours: '50%' },
              ]}
            />
          </div>
        </div>
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          A 50% share is below the category norm. It is paid on an account with no evaluation gating
          it, no monthly fee draining it, and no consistency rule deciding at payout time how much of
          your own profit counts.
        </p>
      </section>

      <section aria-labelledby="not-claiming" className="space-y-4">
        <h2 id="not-claiming" className="text-2xl">
          What we do not claim
        </h2>
        <DisclosureBlock>
          <p>
            <strong className="text-fg">No payout statistics.</strong> We do not publish totals paid,
            payout screenshots or trader counts. We have not operated long enough for any such figure
            to be real.
          </p>
          <p>
            <strong className="text-fg">No testimonials or reviews.</strong> There are none to show
            yet, and inventing them is how this industry earns its reputation.
          </p>
          <p>
            <strong className="text-fg">No regulatory status.</strong> This is not a brokerage
            account. We claim no registration or approval, and we do not suggest that operating a
            simulation removes obligations that may apply under law.
          </p>
          <p>
            <strong className="text-fg">No guarantee of profit or payout.</strong> You can lose the
            fee you paid and receive nothing. Most participants in programs of this kind do not
            receive a payout.
          </p>
          <p>
            <strong className="text-fg">No promise of same-day bank receipt.</strong> Same-day
            eligibility is a rule about when you can request. When funds arrive depends on payment
            rails and banking cut-offs.
          </p>
          <p>
            <strong className="text-fg">Nothing is held for you.</strong> Trading is simulated and
            the account size is a nominal figure, not cash held for you. A $500 gross withdrawal
            reduces your simulated account by $500 and pays you $250 in real cash. The other $250 is
            not income to anyone — it is simulated balance that ceases to exist.
          </p>
        </DisclosureBlock>
      </section>

      {config.company.incomplete && (
        <div className="rounded-xl border border-border-strong bg-surface p-4">
          <div className="flex flex-wrap items-center gap-2">
            <p className="no-caps text-sm font-bold">Company details are not yet published</p>
            <Chip status="UNRESOLVED" />
          </div>
          <p className="no-caps mt-2 text-sm text-fg-muted leading-relaxed">
            The legal entity, jurisdiction, registered address and support contact for this business
            are placeholders. They must be completed before any account is sold for real money, and
            checkout is blocked until they are.
          </p>
        </div>
      )}

      <p className="no-caps text-fg-muted">
        Support is included with every account.{' '}
        <Link href="/contact" className="text-accent hover:underline">
          Contact us
        </Link>
      </p>
    </div>
  );
}
