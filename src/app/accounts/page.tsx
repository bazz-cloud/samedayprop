import type { Metadata } from 'next';
import Link from 'next/link';
import { AccountConfigurator } from '@/components/AccountConfigurator';
import { getAddOnViews, getPlanViews } from '@/server/views/catalog-view';
import { getConfig } from '@/server/config';
import { Chip } from '@/components/system';
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

      {!sellable && (
        <div className="mx-auto max-w-7xl px-4 pb-16">
          <div className="max-w-3xl rounded-xl border border-border-strong bg-card p-4">
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
        </div>
      )}

    </>
  );
}
