import type { Metadata } from 'next';
import Link from 'next/link';
import { getConfig } from '@/server/config';
import { Callout, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'About',
  description: 'What this program is, how it differs from the rest of the category, and what we do not claim.',
};

export default function AboutPage() {
  const config = getConfig();

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-12">
      <header>
        <p className="text-accent font-medium text-sm uppercase tracking-wider">About</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">
          A simpler deal, stated in full
        </h1>
        <p className="mt-4 text-fg-muted leading-relaxed">
          Most futures funding programs ask you to pass an evaluation, pay monthly, and then apply a
          consistency rule that decides how much of your profit counts when you finally request a
          payout. This program removes all three and charges a lower profit share instead.
        </p>
      </header>

      <section aria-labelledby="difference" className="space-y-4">
        <h2 id="difference" className="text-2xl font-bold tracking-tight">
          How this differs
        </h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[34rem] text-sm">
            <caption className="sr-only">Common category terms compared with ours</caption>
            <thead>
              <tr className="border-b border-border-strong text-left text-fg-subtle">
                <th scope="col" className="py-2 pr-4 font-medium">Term</th>
                <th scope="col" className="py-2 pr-4 font-medium">Common in this category</th>
                <th scope="col" className="py-2 font-medium">Here</th>
              </tr>
            </thead>
            <tbody>
              {[
                ['Getting funded', 'Pass an evaluation with a profit target', 'No evaluation. Buy the account and trade it.'],
                ['Cost', 'Monthly subscription, often with an activation fee', 'One-time purchase. No renewal, no activation fee.'],
                ['Drawdown', 'Often end-of-day trailing', 'Intraday trailing, following unrealized equity'],
                ['Consistency rule', 'Commonly a 20–40% best-day cap at payout', 'None'],
                ['Minimum trading days', 'Commonly required before a first payout', 'None. Day one is eligible.'],
                ['Profit split', 'Typically 80–90% to the trader', '50% to the trader'],
              ].map(([term, theirs, ours]) => (
                <tr key={term} className="border-b border-border">
                  <th scope="row" className="py-3 pr-4 font-medium text-left">{term}</th>
                  <td className="py-3 pr-4 text-fg-subtle">{theirs}</td>
                  <td className="py-3 text-fg">{ours}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-fg-subtle leading-relaxed">
          The trade is deliberate and we would rather you see it as a trade than a headline. A 50%
          share is lower than the category norm. It is paid on an account that had no evaluation
          gating it, no monthly fee draining it, and no consistency rule deciding at payout time how
          much of your own profit counts.
        </p>
      </section>

      <section aria-labelledby="model" className="space-y-4">
        <h2 id="model" className="text-2xl font-bold tracking-tight">
          What you are actually buying
        </h2>
        <Card className="p-5 space-y-3 text-sm leading-relaxed text-fg-muted">
          <p>
            <strong className="text-fg">Access to a simulated futures account.</strong> Trading is
            simulated. Orders do not reach a live exchange.
          </p>
          <p>
            <strong className="text-fg">The account size is a nominal figure.</strong> A
            &ldquo;$50,000 account&rdquo; does not mean $50,000 is held for you, and the simulated
            balance cannot itself be withdrawn.
          </p>
          <p>
            <strong className="text-fg">What you can earn is a cash reward</strong> calculated
            against simulated profits. A $500 gross withdrawal reduces your simulated account by $500
            and pays you $250 in real cash. The other $250 is not income to anyone &mdash; it is
            simulated balance that ceases to exist.
          </p>
        </Card>
      </section>

      <section aria-labelledby="not-claiming" className="space-y-4">
        <h2 id="not-claiming" className="text-2xl font-bold tracking-tight">
          What we do not claim
        </h2>
        <ul className="space-y-2.5 text-fg-muted leading-relaxed">
          <li>
            &bull; <strong className="text-fg">No payout statistics.</strong> We do not publish
            totals paid, payout screenshots or trader counts. We have not operated long enough for
            any such figure to be real.
          </li>
          <li>
            &bull; <strong className="text-fg">No testimonials or reviews.</strong> There are none to
            show yet, and inventing them is how this industry earns its reputation.
          </li>
          <li>
            &bull; <strong className="text-fg">No regulatory status.</strong> This is not a brokerage
            account. We claim no registration or approval, and we do not suggest that operating a
            simulation removes obligations that may apply under law.
          </li>
          <li>
            &bull; <strong className="text-fg">No guarantee of profit or payout.</strong> You can
            lose the fee you paid and receive nothing. Most participants in programs of this kind do
            not receive a payout.
          </li>
          <li>
            &bull; <strong className="text-fg">No promise of same-day bank receipt.</strong>{' '}
            Same-day <em>eligibility</em> is a rule about when you can request. When funds arrive
            depends on payment rails and banking cut-offs.
          </li>
        </ul>
      </section>

      {config.company.incomplete && (
        <Callout tone="warn" title="Company details are not yet published">
          The legal entity, jurisdiction, registered address and support contact for this business
          are placeholders on this site. They must be completed before any account is sold for real
          money, and the checkout is blocked until they are.
        </Callout>
      )}

      <section aria-labelledby="contact" className="space-y-3">
        <h2 id="contact" className="text-2xl font-bold tracking-tight">
          Getting in touch
        </h2>
        <p className="text-fg-muted">
          Support is included with every account and you never need to buy anything to get help.{' '}
          <Link href="/contact" className="text-accent hover:underline">
            Contact us
          </Link>
          .
        </p>
      </section>
    </div>
  );
}
