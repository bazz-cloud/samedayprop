'use client';

/**
 * The half-in-cash calculator.
 *
 * This arithmetic is the single most trust-critical thing on the site and it
 * previously read as fine print. A visitor who does not understand it before
 * buying becomes a support ticket after their first withdrawal.
 *
 * The worked amount SCALES with the account: the $25,000 account shows the
 * $500 → $250 minimum, and larger accounts show a withdrawal proportional to
 * their size, capped at what one day's cash cap can actually pay. Showing the
 * same $500 on every tier made the $300,000 account look identical to the
 * cheapest one. The minimum is still stated underneath on every tier, because
 * a bigger example must not read as a bigger floor.
 *
 * Every figure is computed from the account's own published numbers, supplied
 * by the server. Nothing here invents a price or a limit.
 */

import { useState } from 'react';
import Link from 'next/link';

export interface CalculatorPlan {
  readonly key: string;
  readonly label: string;
  readonly startingBalance: string;
  readonly retainedBuffer: string;
  readonly firstWithdrawalAt: string;
  readonly minimumGross: string;
  readonly minimumCash: string;
  readonly exampleAt: string;
  readonly exampleGross: string;
  readonly exampleCash: string;
  readonly exampleLeaves: string;
  readonly exampleIsMinimum: boolean;
  readonly lifetimeCap: string | null;
}

export function WithdrawalCalculator({
  plans,
  defaultPlanKey = 'SIM_50K',
}: {
  plans: readonly CalculatorPlan[];
  defaultPlanKey?: string;
}) {
  const [planKey, setPlanKey] = useState(
    plans.some((p) => p.key === defaultPlanKey) ? defaultPlanKey : (plans[0]?.key ?? ''),
  );
  const plan = plans.find((p) => p.key === planKey) ?? plans[0];
  if (!plan) return null;

  return (
    <div className="grid gap-4 lg:grid-cols-5">
      <div className="lg:col-span-3 rounded-xl border border-border-strong bg-card p-5 sm:p-6">
        <p className="label">What a withdrawal actually does</p>

        <fieldset className="mt-4">
          <legend className="sr-only">Account size</legend>
          <div className="flex flex-wrap gap-2">
            {plans.map((option) => {
              const selected = option.key === plan.key;
              return (
                <label
                  key={option.key}
                  className={`tnum cursor-pointer rounded-lg border px-3 py-1.5 text-sm font-bold transition-colors ${
                    selected
                      ? 'border-accent bg-accent text-bg'
                      : 'border-border-bold text-fg-muted hover:border-accent hover:text-accent'
                  }`}
                >
                  <input
                    type="radio"
                    name="calcPlan"
                    value={option.key}
                    checked={selected}
                    onChange={() => setPlanKey(option.key)}
                    className="sr-only"
                  />
                  {option.label}
                </label>
              );
            })}
          </div>
        </fieldset>

        <dl className="mt-5 space-y-0">
          <Row label="Simulated balance in this example" value={plan.exampleAt} />
          <Row label="Gross withdrawal" value={plan.exampleGross} />
          <div className="flex items-baseline justify-between gap-4 border-b border-border py-3">
            <dt className="no-caps text-sm font-bold">Real cash paid to you</dt>
            <dd className="tnum text-[20px] font-bold text-accent">{plan.exampleCash}</dd>
          </div>
          <Row label="Remaining simulated balance" value={plan.exampleLeaves} last />
        </dl>

        <p className="no-caps mt-4 text-xs text-fg-fine leading-relaxed">
          The other {plan.exampleCash} is not paid to anyone — it is simulated balance that ceases
          to exist. This is an example, not a floor or a target:{' '}
          {plan.exampleIsMinimum ? (
            <>
              <span className="tnum">{plan.minimumGross}</span> gross is also the smallest
              withdrawal on any account, and it unlocks at{' '}
              <span className="tnum">{plan.firstWithdrawalAt}</span>.
            </>
          ) : (
            <>
              the smallest withdrawal on any account is{' '}
              <span className="tnum">{plan.minimumGross}</span> gross for{' '}
              <span className="tnum">{plan.minimumCash}</span> cash, available from{' '}
              <span className="tnum">{plan.firstWithdrawalAt}</span>.
            </>
          )}
          {plan.lifetimeCap && (
            <>
              {' '}This account pays out up to <span className="tnum">{plan.lifetimeCap}</span> in
              total, then closes as complete.
            </>
          )}
        </p>

        <Link
          href={`/checkout?plan=${plan.key}`}
          className="no-caps mt-5 inline-block rounded-[9px] bg-accent px-6 py-3.5 font-semibold text-black hover:bg-accent-strong transition-colors"
        >
          Get funded
        </Link>
      </div>

      <div className="lg:col-span-2 grid grid-cols-2 gap-3 content-start">
        {[
          'No evaluation phase',
          'No consistency rule',
          'No minimum days',
          'No subscription',
        ].map((item) => (
          <div
            key={item}
            className="rounded-xl border border-border-strong bg-card px-4 py-5 text-center"
          >
            <p className="text-xs font-bold tracking-wide">{item.toUpperCase()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 py-3 ${
        last ? '' : 'border-b border-border'
      }`}
    >
      <dt className="no-caps text-sm text-fg-muted">{label}</dt>
      <dd className="tnum text-sm">{value}</dd>
    </div>
  );
}
