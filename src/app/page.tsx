import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { Badge, Card } from '@/components/ui';
import { PlanComparisonTable } from '@/components/PlanComparisonTable';
import { HomeHero } from '@/components/HomeHero';

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
    <>
      <HomeHero />
      <div className="mx-auto max-w-7xl px-4">

      <section aria-labelledby="plans" className="pb-16">
        <div className="flex flex-wrap items-baseline justify-between gap-3 mb-6">
          <h2 id="plans" className="text-2xl font-bold tracking-tight">
            Accounts at a glance
          </h2>
          <Link href="/accounts" className="text-sm text-accent hover:underline">
            Configure an account &rarr;
          </Link>
        </div>
        <PlanComparisonTable plans={plans} />
      </section>

      <section aria-labelledby="differences" className="pb-16">
        <h2 id="differences" className="text-2xl font-bold tracking-tight mb-2">
          What this program does not have
        </h2>
        <p className="text-fg-muted mb-6 max-w-2xl">
          Four things that are standard elsewhere in this category and absent here.
        </p>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            {
              title: 'No evaluation',
              body: 'No challenge to pass and no profit target to hit before you can trade a funded simulated account.',
            },
            {
              title: 'No consistency rule',
              body: 'No best-day concentration test. One large winning day does not reduce or disqualify a payout.',
            },
            {
              title: 'No minimum days',
              body: 'No minimum trading days and no minimum winning days. Day one can be eligible.',
            },
            {
              title: 'No subscription',
              body: 'One-time purchase. Nothing renews, and there is no activation fee on top.',
            },
          ].map((item) => (
            <Card key={item.title} className="p-5">
              <Badge tone="accent">Not required</Badge>
              <h3 className="mt-3 font-semibold">{item.title}</h3>
              <p className="mt-2 text-sm text-fg-muted leading-relaxed">{item.body}</p>
            </Card>
          ))}
        </div>
        <p className="mt-5 text-sm text-fg-subtle max-w-2xl leading-relaxed">
          In exchange, the profit share is 50% rather than the 80&ndash;90% advertised elsewhere.
          That is the trade, and it is stated on every page rather than in a footnote.{' '}
          <Link href="/about" className="text-accent hover:underline">
            More on how this differs
          </Link>
          .
        </p>
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
    </>

  );
}
