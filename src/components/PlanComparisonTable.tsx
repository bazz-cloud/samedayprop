import Link from 'next/link';
import type { PlanView } from '@/server/views/catalog-view';
import { Badge } from './ui';

/**
 * Plan comparison table.
 *
 * This is the module every firm in this category leads with, and the column set
 * is the category's own convention: cost, account size, drawdown model, payout
 * speed, profit split. Traders arrive already knowing how to read it, so the
 * table is the fastest way to be legible to them.
 *
 * The columns are theirs; the VALUES are ours, and several of ours are the
 * opposite of the category norm — a one-time cost rather than a monthly
 * subscription, an intraday trailing drawdown rather than end-of-day, and a
 * 50% split rather than the 90% these firms advertise. Stating our own numbers
 * in the layout traders already scan is the point; borrowing their numbers
 * would describe a product we do not sell.
 */
export function PlanComparisonTable({
  plans,
  compact = false,
}: {
  plans: PlanView[];
  compact?: boolean;
}) {
  return (
    <div className="overflow-x-auto -mx-4 px-4">
      <table className="w-full min-w-[54rem] text-sm border-separate border-spacing-0">
        <caption className="sr-only">
          Cost, account size, drawdown model, payout terms and profit split for each account
        </caption>
        <thead>
          <tr className="text-left">
            {[
              'Account size',
              'Cost',
              'Drawdown model',
              'Daily loss limit',
              'First payout at',
              'Payout timing',
              'Your split',
            ].map((heading) => (
              <th
                key={heading}
                scope="col"
                className="px-3 py-3 font-medium text-fg-subtle border-b border-border-strong whitespace-nowrap"
              >
                {heading}
              </th>
            ))}
            <th scope="col" className="border-b border-border-strong" />
          </tr>
        </thead>
        <tbody>
          {plans.map((plan) => (
            <tr key={plan.key} className="group">
              <th
                scope="row"
                className="px-3 py-4 text-left border-b border-border align-top"
              >
                <span className="block text-base font-semibold tnum">{plan.label}</span>
                <span className="block text-xs text-fg-subtle mt-0.5">
                  {plan.positionCeiling.minis} minis / {plan.positionCeiling.micros} micros
                </span>
              </th>

              <td className="px-3 py-4 border-b border-border align-top">
                <span className="block text-accent font-semibold tnum">
                  {plan.couponPrice.display}
                </span>
                <span className="block text-fg-subtle line-through tnum text-xs">
                  {plan.listPrice.display}
                </span>
                <span className="block text-xs text-fg-subtle mt-1">
                  One-time &middot; no renewal
                </span>
              </td>

              <td className="px-3 py-4 border-b border-border align-top">
                <span className="block tnum">{plan.drawdownAllowance.display}</span>
                <span className="block text-xs text-fg-subtle mt-0.5">
                  Intraday trailing, stops at {plan.trailingStopAt.display}
                </span>
              </td>

              <td className="px-3 py-4 border-b border-border align-top tnum">
                {plan.dailyLossLimit.display}
              </td>

              <td className="px-3 py-4 border-b border-border align-top">
                <span className="block tnum">{plan.firstWithdrawalAt.display}</span>
                <span className="block text-xs text-fg-subtle mt-0.5">
                  pays {plan.firstWithdrawalCash.display} cash
                </span>
              </td>

              <td className="px-3 py-4 border-b border-border align-top">
                <span className="block">Same day eligible</span>
                <span className="block text-xs text-fg-subtle mt-0.5">
                  incl. day one &middot; {plan.dailyCashCap.display}/day cap
                </span>
              </td>

              <td className="px-3 py-4 border-b border-border align-top">
                <span className="block font-semibold">50%</span>
                <span className="block text-xs text-fg-subtle mt-0.5">of gross withdrawal</span>
              </td>

              <td className="px-3 py-4 border-b border-border align-top text-right">
                <Link
                  href={`/checkout?plan=${plan.key}`}
                  className="inline-block rounded-lg bg-accent px-4 py-2 font-semibold text-bg hover:bg-accent-strong transition-colors whitespace-nowrap"
                >
                  Start now
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {!compact && (
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-xs text-fg-subtle">
          <span className="flex items-center gap-1.5">
            <Badge tone="accent">No evaluation</Badge>
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone="accent">No consistency rule</Badge>
          </span>
          <span className="flex items-center gap-1.5">
            <Badge tone="accent">No minimum trading days</Badge>
          </span>
          <span>
            Discounted prices apply with code{' '}
            <span className="font-mono text-fg-muted">{plans[0]?.couponCode}</span>.
          </span>
        </div>
      )}
    </div>
  );
}
