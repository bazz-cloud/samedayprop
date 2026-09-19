import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { PlanComparisonTable } from '@/components/PlanComparisonTable';
import { HomeHero } from '@/components/HomeHero';
import { DisclosureBlock, SpecTable, StatGrid, StatPair } from '@/components/system';
import { WithdrawalCalculator } from '@/components/WithdrawalCalculator';

/**
 * Home.
 *
 * States plainly what is being sold and what it is not. There are no decorative
 * trading charts, no invented activity feeds, no trust badges and no customer
 * counts — none of those would be true, and a chart of made-up performance on a
 * page selling simulated accounts is exactly the wrong first impression.
 *
 * Compressed to the shared system: features are stat pairs, every number is in
 * a table, and no prose repeats a cell. The disclosures at the foot are NOT
 * compressed — they are the claims we are declining to make, and shortening
 * them would change what is being disclaimed.
 */
export default function HomePage() {
  const plans = getPlanViews();
  const fiftyK = plans.find((p) => p.key === 'SIM_50K')!;
  const calculatorPlans = plans.map((plan) => ({
    key: plan.key,
    label: plan.label,
    startingBalance: plan.startingBalance.display,
    retainedBuffer: plan.retainedBuffer.display,
    firstWithdrawalAt: plan.firstWithdrawalAt.display,
    firstWithdrawalGross: plan.firstWithdrawalGross.display,
    firstWithdrawalCash: plan.firstWithdrawalCash.display,
    firstWithdrawalLeaves: plan.firstWithdrawalLeaves.display,
    lifetimeCap: plan.lifetimeCapResolved
      ? (plan.lifetimeCapDescription.split(' ')[0] ?? null)
      : null,
  }));

  return (
    <>
      <HomeHero />
      <div className="mx-auto max-w-7xl px-4">
        {/* Directly under the hero, which is deliberately unchanged. The
            $500 -> $250 arithmetic is the strongest trust asset on the site and
            previously read as fine print. */}
        <section aria-labelledby="calculator" className="pb-14">
          <h2 id="calculator" className="sr-only">
            What a withdrawal pays you
          </h2>
          <WithdrawalCalculator plans={calculatorPlans} />
        </section>

        <section aria-labelledby="plans" className="pb-14">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-5">
            <h2 id="plans" className="text-2xl">
              Accounts
            </h2>
            <Link href="/accounts" className="no-caps text-sm text-accent hover:underline">
              Configure an account &rarr;
            </Link>
          </div>
          <PlanComparisonTable plans={plans} />
        </section>

        <section aria-labelledby="how" className="pb-14">
          <h2 id="how" className="text-2xl mb-5">
            How it works
          </h2>
          <StatGrid>
            <StatPair icon="1" label="Sign, then pay" />
            <StatPair icon="2" label="Trade published limits" />
            <StatPair icon="3" label="Request your payout" />
            <StatPair icon="4" label="Cash, same day" />
          </StatGrid>
          <p className="no-caps mt-4 text-sm text-fg-muted max-w-2xl">
            You sign the agreements before you are charged. Limits are enforced on our servers.{' '}
            <Link href="/rules" className="text-accent hover:underline">
              Every rule in full
            </Link>
          </p>
        </section>

        <section aria-labelledby="example" className="pb-14">
          <h2 id="example" className="text-2xl mb-5">
            Worked example: {fiftyK.label}
          </h2>
          <div className="max-w-2xl">
            <SpecTable
              caption={`First withdrawal on the ${fiftyK.label} account`}
              columns={[
                { key: 'item', label: 'Item' },
                { key: 'amount', label: 'Amount', numeric: true },
              ]}
              rows={[
                { item: 'Starting simulated balance', amount: fiftyK.startingBalance.display },
                { item: 'Retained profit buffer', amount: fiftyK.retainedBuffer.display },
                { item: 'First withdrawal available at', amount: fiftyK.firstWithdrawalAt.display },
                { item: 'Gross withdrawal requested', amount: fiftyK.firstWithdrawalGross.display },
                {
                  item: 'Real cash paid to you',
                  amount: (
                    <span className="text-accent font-bold">{fiftyK.firstWithdrawalCash.display}</span>
                  ),
                },
                {
                  item: 'Simulated balance remaining',
                  amount: fiftyK.firstWithdrawalLeaves.display,
                },
              ]}
            />
            <p className="no-caps mt-3 text-xs text-fg-subtle leading-relaxed">
              The other {fiftyK.firstWithdrawalCash.display} is not paid to anyone. It is simulated
              balance that ceases to exist. At <span className="tnum">$52,499.00</span> no
              withdrawal is available: the available gross would be $499, below the $500 minimum.
            </p>
          </div>
        </section>

        <section aria-labelledby="honesty" className="pb-16">
          <h2 id="honesty" className="text-2xl mb-5">
            What we are not claiming
          </h2>
          <div className="max-w-2xl">
            <DisclosureBlock>
              <p>We do not guarantee profits, rewards or payouts of any kind.</p>
              <p>
                We do not guarantee that cash reaches your bank the same day. Eligibility rules and
                payment timing are different things.
              </p>
              <p>Most participants in programs of this kind do not receive a payout.</p>
              <p>
                You can breach a limit and lose access to the account, and the purchase fee with it.
              </p>
              <p>
                We make no claim of regulatory approval or registration, and we do not claim that
                simulation removes any obligation that may apply under law.
              </p>
            </DisclosureBlock>
          </div>
        </section>
      </div>
    </>
  );
}
