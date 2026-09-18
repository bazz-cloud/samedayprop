import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { Card } from '@/components/ui';

/**
 * Home.
 *
 * States plainly what is being sold and what it is not. There are no decorative
 * trading charts, no invented activity feeds, no trust badges and no customer
 * counts — none of those would be true, and a chart of made-up performance on a
 * page selling simulated accounts is exactly the wrong first impression.
 */
export default function HomePage() {
  const plans = getPlanViews();
  const fiftyK = plans.find((p) => p.key === 'SIM_50K')!;

  return (
    <div className="mx-auto max-w-7xl px-4">
      <section className="py-16 sm:py-24 max-w-3xl">
        <p className="text-accent font-medium text-sm uppercase tracking-wider">
          Simulated futures accounts
        </p>
        <h1 className="mt-3 text-4xl sm:text-5xl font-bold tracking-tight leading-tight">
          Buy an account. Trade it the same day. No evaluation.
        </h1>
        <p className="mt-5 text-lg text-fg-muted leading-relaxed">
          Purchase access to a simulated futures account and start trading it under published
          rules. There is no evaluation phase, no profit target to pass first, no consistency
          rule and no minimum number of trading days.
        </p>
        <p className="mt-4 text-fg-subtle leading-relaxed">
          Trading is simulated. The account size is a nominal figure, not cash held for you. What
          you can earn is a real cash reward calculated against simulated profits, split 50/50: a{' '}
          <span className="text-fg-muted tnum">$500</span> gross withdrawal reduces the simulated
          account by <span className="text-fg-muted tnum">$500</span> and pays you{' '}
          <span className="text-fg-muted tnum">$250</span> in cash.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link
            href="/accounts"
            className="rounded-lg bg-accent px-6 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
          >
            Compare accounts
          </Link>
          <Link
            href="/rules"
            className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent hover:text-accent transition-colors"
          >
            Read the rules first
          </Link>
        </div>
      </section>

      <section aria-labelledby="what-you-get" className="pb-16">
        <h2 id="what-you-get" className="text-2xl font-bold tracking-tight mb-6">
          How it works
        </h2>
        <div className="grid gap-4 md:grid-cols-3">
          {[
            {
              step: '1',
              title: 'Buy an account',
              body: 'One-time purchase, not a subscription. You see the exact rules and price before you sign anything, and you sign the agreements before you are charged.',
            },
            {
              step: '2',
              title: 'Trade under published limits',
              body: 'Each account has a daily loss limit, an intraday trailing drawdown that follows your highest equity including unrealized gains, and a position ceiling. All three are enforced on our servers.',
            },
            {
              step: '3',
              title: 'Request a payout when eligible',
              body: 'Once your simulated balance exceeds your starting balance plus your retained buffer by at least $500, you can request a payout. Half the gross is paid to you in real cash.',
            },
          ].map((item) => (
            <Card key={item.step} className="p-5">
              <span
                aria-hidden="true"
                className="inline-grid h-8 w-8 place-items-center rounded-full border border-accent/40 bg-accent-dim text-accent font-semibold text-sm"
              >
                {item.step}
              </span>
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-fg-muted leading-relaxed">{item.body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="example" className="pb-16">
        <h2 id="example" className="text-2xl font-bold tracking-tight mb-2">
          A worked example
        </h2>
        <p className="text-fg-muted mb-6">
          The {fiftyK.label} account, under its published rules.
        </p>
        <Card className="p-6 max-w-2xl">
          <dl className="space-y-0">
            {[
              ['Starting simulated balance', fiftyK.startingBalance.display],
              ['Retained profit buffer', fiftyK.retainedBuffer.display],
              ['First withdrawal available at', fiftyK.firstWithdrawalAt.display],
              ['Gross withdrawal requested', fiftyK.firstWithdrawalGross.display],
              ['Real cash paid to you', fiftyK.firstWithdrawalCash.display],
              ['Simulated balance remaining', fiftyK.firstWithdrawalLeaves.display],
            ].map(([label, value], index, all) => (
              <div
                key={label}
                className={`flex items-baseline justify-between gap-4 py-2.5 ${
                  index < all.length - 1 ? 'border-b border-border' : ''
                }`}
              >
                <dt className="text-sm text-fg-muted">{label}</dt>
                <dd
                  className={`tnum ${
                    label === 'Real cash paid to you' ? 'text-accent font-semibold' : ''
                  }`}
                >
                  {value}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-fg-subtle leading-relaxed">
            The other {fiftyK.firstWithdrawalCash.display} of the gross withdrawal is not paid to
            anyone. It is simulated balance that ceases to exist. At a balance of{' '}
            <span className="tnum">$52,499.00</span> no withdrawal would be available yet, because
            the available gross would be $499 — below the $500 minimum.
          </p>
        </Card>
      </section>

      <section aria-labelledby="honesty" className="pb-16">
        <h2 id="honesty" className="text-2xl font-bold tracking-tight mb-4">
          What we are not claiming
        </h2>
        <ul className="space-y-2 text-fg-muted max-w-2xl leading-relaxed">
          <li>&bull; We do not guarantee profits, rewards or payouts of any kind.</li>
          <li>
            &bull; We do not guarantee that cash reaches your bank the same day. Eligibility rules
            and payment timing are different things.
          </li>
          <li>&bull; Most participants in programs of this kind do not receive a payout.</li>
          <li>
            &bull; You can breach a limit and lose access to the account, and the purchase fee with
            it.
          </li>
          <li>
            &bull; We make no claim of regulatory approval or registration, and we do not claim
            that simulation removes any obligation that may apply under law.
          </li>
        </ul>
      </section>
    </div>
  );
}
