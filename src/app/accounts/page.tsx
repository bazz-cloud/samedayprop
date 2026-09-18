import type { Metadata } from 'next';
import Link from 'next/link';
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
          No evaluation. No consistency rule. No minimum trading days.{' '}
          <Link href="/rules" className="text-accent hover:underline">
            Full rules
          </Link>
          .
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
