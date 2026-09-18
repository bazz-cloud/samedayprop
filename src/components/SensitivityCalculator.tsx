'use client';

/**
 * Sensitivity calculator.
 *
 * Every field is an editable ASSUMPTION, labelled as one. The calculator does
 * not supply a payout probability or an average payout from anywhere — the
 * owner has to state what they believe, and the model shows the consequences,
 * including the probability at which the product stops making money.
 */

import { useMemo, useState } from 'react';
import { Callout, Card, DataRow } from './ui';

interface Inputs {
  discountedPrice: string;
  lifetimeVariableCosts: string;
  acquisitionCost: string;
  payoutProbabilityPercent: string;
  conditionalAveragePayout: string;
  fixedMonthlyOverhead: string;
  activeAccounts: string;
  newSalesPerMonth: string;
  cashReserves: string;
}

const DEFAULTS: Inputs = {
  discountedPrice: '449.25',
  lifetimeVariableCosts: '120.00',
  acquisitionCost: '0.00',
  payoutProbabilityPercent: '30',
  conditionalAveragePayout: '1000.00',
  fixedMonthlyOverhead: '8000.00',
  activeAccounts: '0',
  newSalesPerMonth: '100',
  cashReserves: '50000.00',
};

const money = (value: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);

const FIELDS: { key: keyof Inputs; label: string; hint: string; prefix?: string; suffix?: string }[] =
  [
    {
      key: 'discountedPrice',
      label: 'Price actually collected',
      hint: 'After any discount. The $50,000 account is $449.25 with the 25% code.',
      prefix: '$',
    },
    {
      key: 'lifetimeVariableCosts',
      label: 'Lifetime variable cost per account',
      hint: 'Processing fees, platform and market data cost, support, add-on delivery.',
      prefix: '$',
    },
    {
      key: 'acquisitionCost',
      label: 'Customer acquisition cost',
      hint: 'Marketing spend divided by paying customers acquired.',
      prefix: '$',
    },
    {
      key: 'payoutProbabilityPercent',
      label: 'Probability an account ever pays out',
      hint: 'Your assumption. Nothing in this system estimates it for you.',
      suffix: '%',
    },
    {
      key: 'conditionalAveragePayout',
      label: 'Average total cash paid, given a payout happens',
      hint: 'Not the average across all accounts — the average across paying ones only.',
      prefix: '$',
    },
    {
      key: 'fixedMonthlyOverhead',
      label: 'Fixed monthly overhead',
      hint: 'Salaries, tooling, hosting, professional fees.',
      prefix: '$',
    },
    { key: 'newSalesPerMonth', label: 'New sales per month', hint: 'Your assumption.' },
    {
      key: 'activeAccounts',
      label: 'Active accounts',
      hint: 'Accounts still able to trade and therefore still able to generate an obligation.',
    },
    {
      key: 'cashReserves',
      label: 'Cash reserves',
      hint: 'Cash available to meet payout obligations and overhead.',
      prefix: '$',
    },
  ];

export function SensitivityCalculator() {
  const [inputs, setInputs] = useState<Inputs>(DEFAULTS);

  const result = useMemo(() => {
    const price = Number(inputs.discountedPrice) || 0;
    const variable = Number(inputs.lifetimeVariableCosts) || 0;
    const acquisition = Number(inputs.acquisitionCost) || 0;
    const probability = Math.min(100, Math.max(0, Number(inputs.payoutProbabilityPercent) || 0));
    const averagePayout = Number(inputs.conditionalAveragePayout) || 0;
    const overhead = Number(inputs.fixedMonthlyOverhead) || 0;
    const active = Math.max(0, Math.floor(Number(inputs.activeAccounts) || 0));
    const sales = Math.max(0, Math.floor(Number(inputs.newSalesPerMonth) || 0));
    const reserves = Number(inputs.cashReserves) || 0;

    const expectedPayoutCost = (probability / 100) * averagePayout;
    const grossMargin = price - variable;
    const contribution = grossMargin - expectedPayoutCost;
    const afterAcquisition = contribution - acquisition;
    const monthlyContribution = afterAcquisition * sales;
    const monthlyProfit = monthlyContribution - overhead;

    const availableForPayouts = grossMargin - acquisition;
    const breakEvenProbability =
      averagePayout > 0 && availableForPayouts > 0
        ? (availableForPayouts / averagePayout) * 100
        : null;
    const breakEvenSales = afterAcquisition > 0 ? Math.ceil(overhead / afterAcquisition) : null;
    const expectedObligation = expectedPayoutCost * active;
    const runoffMonths = overhead > 0 ? Math.floor(reserves / overhead) : null;

    const warnings: string[] = [];
    if (contribution <= 0) {
      warnings.push(
        'Contribution per sale is not positive before fixed overhead. Under these assumptions ' +
          'the base product loses money on every sale.',
      );
    }
    if (breakEvenProbability !== null && breakEvenProbability - probability < 5) {
      warnings.push(
        `Contribution turns negative once the payout probability reaches ${breakEvenProbability.toFixed(1)}%. ` +
          `Your assumption is ${probability.toFixed(1)}%, leaving under five percentage points of margin for error.`,
      );
    }
    if (expectedObligation > reserves) {
      warnings.push(
        `Expected outstanding payout obligation of ${money(expectedObligation)} exceeds cash reserves of ${money(reserves)}.`,
      );
    }
    if (active > 0) {
      warnings.push(
        'Active accounts that have not yet paid out are not proven zero-payout outcomes. Their ' +
          'expected obligation is included above and is not earned margin.',
      );
    }

    return {
      expectedPayoutCost,
      grossMargin,
      contribution,
      afterAcquisition,
      monthlyContribution,
      monthlyProfit,
      breakEvenProbability,
      breakEvenSales,
      expectedObligation,
      runoffMonths,
      warnings,
      probability,
    };
  }, [inputs]);

  const set = (key: keyof Inputs) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setInputs((current) => ({ ...current, [key]: event.target.value }));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-semibold">Assumptions</h2>
        <p className="text-xs text-fg-subtle mt-1 mb-4">
          Every figure below is something you are assuming. None of them is a forecast, an industry
          benchmark or an observed result from this business.
        </p>
        <div className="space-y-4">
          {FIELDS.map((field) => (
            <div key={field.key}>
              <label htmlFor={field.key} className="block text-sm font-medium mb-1">
                {field.label}
              </label>
              <div className="flex items-center gap-2">
                {field.prefix && (
                  <span aria-hidden="true" className="text-fg-subtle">
                    {field.prefix}
                  </span>
                )}
                <input
                  id={field.key}
                  type="number"
                  step="any"
                  min="0"
                  value={inputs[field.key]}
                  onChange={set(field.key)}
                  aria-describedby={`${field.key}-hint`}
                  className="flex-1 rounded-lg border border-border bg-surface px-3 py-2 tnum focus:border-accent"
                />
                {field.suffix && (
                  <span aria-hidden="true" className="text-fg-subtle">
                    {field.suffix}
                  </span>
                )}
              </div>
              <p id={`${field.key}-hint`} className="text-xs text-fg-subtle mt-1">
                {field.hint}
              </p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setInputs(DEFAULTS)}
          className="mt-4 text-sm text-fg-subtle hover:text-fg underline"
        >
          Reset to the reference scenario
        </button>
      </Card>

      <div className="space-y-6">
        <Card className="p-5">
          <h2 className="font-semibold mb-3">Per sale</h2>
          <dl>
            <DataRow label="Price collected" value={money(Number(inputs.discountedPrice) || 0)} />
            <DataRow
              label="Less variable costs"
              value={`−${money(Number(inputs.lifetimeVariableCosts) || 0)}`}
            />
            <DataRow
              label="Less expected payout cost"
              value={`−${money(result.expectedPayoutCost)}`}
              hint={`${result.probability}% x ${money(Number(inputs.conditionalAveragePayout) || 0)}. This is the term that decides the business.`}
            />
            <DataRow
              label="Contribution before overhead"
              value={money(result.contribution)}
              emphasis
            />
            <DataRow
              label="Less acquisition cost"
              value={`−${money(Number(inputs.acquisitionCost) || 0)}`}
            />
            <DataRow
              label="Contribution after acquisition"
              value={money(result.afterAcquisition)}
              emphasis
            />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Monthly and break-even</h2>
          <dl>
            <DataRow label="Monthly contribution" value={money(result.monthlyContribution)} />
            <DataRow
              label="Monthly profit after overhead"
              value={money(result.monthlyProfit)}
              emphasis
            />
            <DataRow
              label="Sales needed to cover overhead"
              value={result.breakEvenSales === null ? 'Never at this contribution' : result.breakEvenSales}
            />
            <DataRow
              label="Payout probability at which contribution hits zero"
              value={
                result.breakEvenProbability === null
                  ? 'Already negative'
                  : `${result.breakEvenProbability.toFixed(1)}%`
              }
              hint="Above this rate, every sale loses money."
            />
            <DataRow
              label="Expected outstanding obligation"
              value={money(result.expectedObligation)}
              hint="Across active accounts that have not yet paid out."
            />
            <DataRow
              label="Zero-new-sales runoff"
              value={result.runoffMonths === null ? 'n/a' : `${result.runoffMonths} months`}
              hint="How long reserves cover fixed overhead with no further sales."
            />
          </dl>
        </Card>

        {result.warnings.length > 0 && (
          <Callout tone="warn" title="What this model is telling you">
            <ul className="list-disc pl-5 space-y-1.5">
              {result.warnings.map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
            </ul>
          </Callout>
        )}

        <Callout tone="neutral">
          Simulated retained profit is never revenue and does not appear anywhere in this model. Nor
          do optional add-ons: if the base product is loss-making at your assumed payout rate,
          attaching an add-on to some fraction of sales does not fix it, and track the real
          attachment rate and delivery cost before assuming otherwise.
        </Callout>
      </div>
    </div>
  );
}
