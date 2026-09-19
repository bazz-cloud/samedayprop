import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountConfigurator } from '@/components/AccountConfigurator';
import { getAddOnViews, getPlanViews } from '@/server/views/catalog-view';
import { getConfig } from '@/server/config';
import { Chip, SpecTable } from '@/components/system';
import { PlanCards, PricingFootnotes } from '@/components/PlanCards';

export const metadata: Metadata = {
  title: 'Choose an account',
  description:
    'Compare simulated futures account sizes, limits and payout rules, and configure your purchase.',
};

/**
 * Accounts.
 *
 * Almost entirely a table. Someone choosing between five account sizes is
 * comparing numbers, and a paragraph beside each number buries it — so every
 * figure lives in the table and nothing in prose repeats a cell.
 *
 * The status markers and the paragraph explaining that accounts are not sold
 * while any term is unapproved are NOT compressed away. They are the reason a
 * visitor can trust the rest of the numbers.
 */
export default function AccountsPage() {
  const plans = getPlanViews();
  const addOns = getAddOnViews();
  const config = getConfig();

  // Deduplicated by field: a term shared by every plan (the trailing stop
  // offset is) appears once on each of them, and listing it five times would
  // report one open decision as five.
  const unapproved = [
    ...new Map(
      plans.flatMap((plan) => plan.launchBlockers).map((blocker) => [blocker.field, blocker]),
    ).values(),
  ];
  const sellable = plans.every((plan) => plan.sellable);

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-10 pb-10">
        <h1 className="text-3xl sm:text-4xl">Choose your account</h1>
        <p className="no-caps text-fg-muted mt-2">
          One-time purchase. Prices shown with code{' '}
          <span className="font-mono text-fg">{plans[0]?.couponCode}</span>.{' '}
          <Link href="/rules" className="text-accent hover:underline">
            Full rules
          </Link>
        </p>

        <div className="mt-8">
          <PlanCards plans={plans} />
        </div>

        <div className="mt-8">
          <PricingFootnotes fiftyK={plans.find((p) => p.key === 'SIM_50K')!} />
        </div>
      </div>

      <AccountConfigurator
        plans={plans}
        addOns={addOns}
        defaultPlanKey="SIM_50K"
        isDemo={config.isDemo}
      />

      {/* Cross-shopping comes AFTER choosing. Someone who already knows the size
          they want should not have to scroll past five rows of numbers to pick
          it; someone comparing can still see every account side by side here. */}
      <div className="mx-auto max-w-7xl px-4 pb-16">
        <h2 id="compare" className="text-2xl mb-4 scroll-mt-24">
          Compare all five
        </h2>
        <div className="mt-6 overflow-x-auto">
          <div className="min-w-[60rem]">
            <SpecTable
              caption="Price, position ceiling, risk limits and payout caps for each account size"
              columns={[
                { key: 'size', label: 'Account' },
                { key: 'price', label: 'Price', numeric: true },
                { key: 'positions', label: 'Positions', numeric: true },
                { key: 'dailyLoss', label: 'Daily loss', numeric: true },
                { key: 'drawdown', label: 'Max drawdown', numeric: true },
                { key: 'buffer', label: 'Buffer', numeric: true },
                { key: 'dailyCap', label: 'Daily cap', numeric: true },
                { key: 'lifetimeCap', label: 'Lifetime cap', numeric: true },
                { key: 'action', label: '', numeric: true },
              ]}
              rows={plans.map((plan) => ({
                size: (
                  <span className="text-base font-bold tnum">{plan.label}</span>
                ),
                price: (
                  <>
                    <span className="block text-accent font-bold tnum">
                      {plan.couponPrice.display}
                    </span>
                    <span className="block text-xs text-fg-subtle line-through tnum">
                      {plan.listPrice.display}
                    </span>
                  </>
                ),
                positions: `${plan.positionCeiling.minis} / ${plan.positionCeiling.micros}`,
                dailyLoss: plan.dailyLossLimit.display,
                drawdown: plan.drawdownAllowance.display,
                buffer: plan.retainedBuffer.display,
                dailyCap: plan.dailyCashCap.display,
                lifetimeCap: plan.lifetimeCapResolved ? (
                  plan.lifetimeCapDescription.split(' ')[0]
                ) : (
                  <Chip status="UNRESOLVED" />
                ),
                action: (
                  <Link
                    href={`/checkout?plan=${plan.key}`}
                    className="no-caps inline-block rounded-lg bg-accent px-4 py-2 font-bold text-bg hover:bg-accent-strong transition-colors whitespace-nowrap"
                  >
                    Start now
                  </Link>
                ),
              }))}
            />
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-fg-subtle">
          <span className="no-caps">Positions: minis / micros. Drawdown is intraday trailing.</span>
          <span className="no-caps">Payouts are 50% of gross, in cash, same day.</span>
          <span className="flex items-center gap-2">
            <Chip status="CONFIRMED" />
            <Chip status="PROPOSED" />
            <Chip status="UNRESOLVED" />
          </span>
        </div>

        {!sellable && (
          <div className="mt-5 max-w-3xl rounded-xl border border-border-strong bg-surface p-4">
            <p className="no-caps text-sm font-bold">
              {unapproved.length === 0
                ? 'Accounts are not sold for real money yet.'
                : unapproved.length === 1
                  ? '1 term still awaits approval.'
                  : `${unapproved.length} terms still await approval.`}
            </p>
            <p className="no-caps mt-2 text-sm text-fg-muted leading-relaxed">
              Accounts are not sold for real money while any term above remains unapproved. Terms
              marked proposed are development defaults that have not been commercially approved, and
              terms marked not decided have no value set at all.
            </p>
            {unapproved.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-fg-muted">
                {unapproved.map((blocker) => (
                  <li key={`${blocker.field}-${blocker.status}`} className="flex gap-2">
                    <Chip status={blocker.status === 'PROPOSED' ? 'PROPOSED' : 'UNRESOLVED'} />
                    <span className="no-caps">{blocker.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </>
  );
}
