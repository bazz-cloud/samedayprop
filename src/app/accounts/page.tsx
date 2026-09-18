import type { Metadata } from 'next';
import { AccountConfigurator } from '@/components/AccountConfigurator';
import { getAddOnViews, getPlanViews } from '@/server/views/catalog-view';
import { getConfig } from '@/server/config';

export const metadata: Metadata = {
  title: 'Choose an account',
  description:
    'Compare simulated futures account sizes, limits and payout rules, and configure your purchase.',
};

export default function AccountsPage() {
  const plans = getPlanViews();
  const addOns = getAddOnViews();
  const config = getConfig();

  return (
    <>
      <div className="mx-auto max-w-7xl px-4 pt-10 pb-6">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Choose your account</h1>
        <p className="text-fg-muted mt-2 max-w-2xl">
          No evaluation phase. No consistency rule. No minimum trading days. Payout eligibility can
          be reached on your first trading day if every other published requirement is met.
        </p>
      </div>
      <AccountConfigurator
        plans={plans}
        addOns={addOns}
        defaultPlanKey="SIM_50K"
        isDemo={config.isDemo}
      />
    </>
  );
}
