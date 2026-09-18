/**
 * Contribution and runoff modelling.
 *
 * Every input here is an ASSUMPTION the owner sets. This module does not invent
 * a payout probability, a conversion rate or an average payout, and it never
 * treats simulated retained profit as revenue.
 *
 * The central relationship:
 *
 *   contribution per sale = discounted price
 *                         - lifetime variable costs
 *                         - (payout probability x conditional average payout)
 *
 * The third term is the one that decides whether the business works. It is an
 * EXPECTED value: most accounts pay nothing, a minority pay a lot, and the
 * product of the two is what each sale actually costs on average. A model that
 * looks at gross purchase receipts alone will always look profitable.
 */

import { Money, divideRounded } from '../money/money';

export interface SensitivityAssumptions {
  /** Price actually collected after any discount. */
  readonly discountedPrice: Money;
  /** Processor fees, provider fees, support and add-on delivery, per account. */
  readonly lifetimeVariableCosts: Money;
  /** Marketing and other cost to acquire one paying customer. */
  readonly acquisitionCost: Money;
  /**
   * Probability that an account ever receives a cash payout, in basis points.
   * Integer basis points rather than a float keeps the arithmetic exact.
   */
  readonly payoutProbabilityBps: number;
  /** Average TOTAL cash paid to an account that does receive a payout. */
  readonly conditionalAveragePayout: Money;
  /** Monthly fixed overhead. */
  readonly fixedMonthlyOverhead: Money;
  readonly activeAccounts: number;
  readonly newSalesPerMonth: number;
  /** Cash currently held against outstanding obligations. */
  readonly cashReserves: Money;
}

export interface SensitivityResult {
  /** Expected cash payout cost per sale: probability x conditional average. */
  readonly expectedPayoutCost: Money;
  /** Price minus variable costs, before acquisition and before payout cost. */
  readonly grossMarginPerSale: Money;
  /** The headline figure, BEFORE fixed overhead. */
  readonly contributionPerSale: Money;
  /** Contribution after acquisition cost. */
  readonly contributionAfterAcquisition: Money;
  readonly monthlyContribution: Money;
  readonly monthlyProfit: Money;
  /** Sales per month needed to cover fixed overhead. Null when impossible. */
  readonly breakEvenSalesPerMonth: number | null;
  /**
   * The payout probability at which contribution reaches zero, in basis points.
   * Null when the product loses money even with zero payouts.
   */
  readonly breakEvenPayoutProbabilityBps: number | null;
  /** Expected outstanding payout obligation across active accounts. */
  readonly expectedOutstandingObligation: Money;
  /** Months of fixed overhead the reserves cover with no new sales. */
  readonly runoffMonths: number | null;
  readonly warnings: readonly string[];
}

export function computeSensitivity(assumptions: SensitivityAssumptions): SensitivityResult {
  const warnings: string[] = [];

  if (assumptions.payoutProbabilityBps < 0 || assumptions.payoutProbabilityBps > 10_000) {
    throw new Error('Payout probability must be between 0 and 10000 basis points');
  }

  const expectedPayoutCost = assumptions.conditionalAveragePayout.mulRatio(
    BigInt(assumptions.payoutProbabilityBps),
    10_000n,
    'half-up',
  );

  const grossMarginPerSale = assumptions.discountedPrice.minus(assumptions.lifetimeVariableCosts);
  const contributionPerSale = grossMarginPerSale.minus(expectedPayoutCost);
  const contributionAfterAcquisition = contributionPerSale.minus(assumptions.acquisitionCost);

  const monthlyContribution = contributionAfterAcquisition.timesInt(assumptions.newSalesPerMonth);
  const monthlyProfit = monthlyContribution.minus(assumptions.fixedMonthlyOverhead);

  // Break-even sales per month, rounded UP: a partial sale does not exist.
  const breakEvenSalesPerMonth = contributionAfterAcquisition.isPositive()
    ? Number(
        divideRounded(
          assumptions.fixedMonthlyOverhead.minor,
          contributionAfterAcquisition.minor,
          'ceil',
        ),
      )
    : null;

  // The probability at which contribution hits zero:
  //   grossMargin - acquisition = p x conditionalAverage
  const availableForPayouts = grossMarginPerSale.minus(assumptions.acquisitionCost);
  const breakEvenPayoutProbabilityBps =
    availableForPayouts.isPositive() && assumptions.conditionalAveragePayout.isPositive()
      ? Number(
          divideRounded(
            availableForPayouts.minor * 10_000n,
            assumptions.conditionalAveragePayout.minor,
            'floor',
          ),
        )
      : null;

  const expectedOutstandingObligation = expectedPayoutCost.timesInt(assumptions.activeAccounts);

  // Runoff: with zero new sales, how long do reserves cover fixed overhead?
  const runoffMonths = assumptions.fixedMonthlyOverhead.isPositive()
    ? Number(
        divideRounded(
          assumptions.cashReserves.minor,
          assumptions.fixedMonthlyOverhead.minor,
          'floor',
        ),
      )
    : null;

  // ---- warnings -----------------------------------------------------------
  if (!contributionPerSale.isPositive()) {
    warnings.push(
      'Contribution per sale is not positive before fixed overhead. Under these assumptions ' +
        'the base product loses money on every sale.',
    );
  }
  if (
    breakEvenPayoutProbabilityBps !== null &&
    breakEvenPayoutProbabilityBps - assumptions.payoutProbabilityBps < 500
  ) {
    warnings.push(
      `Contribution turns negative once the payout probability reaches ` +
        `${(breakEvenPayoutProbabilityBps / 100).toFixed(1)}%. The current assumption is ` +
        `${(assumptions.payoutProbabilityBps / 100).toFixed(1)}%, leaving under five ` +
        'percentage points of margin for error.',
    );
  }
  if (expectedOutstandingObligation.gt(assumptions.cashReserves)) {
    warnings.push(
      `Expected outstanding payout obligation of ${expectedOutstandingObligation.format()} ` +
        `exceeds cash reserves of ${assumptions.cashReserves.format()}.`,
    );
  }
  if (assumptions.activeAccounts > 0) {
    warnings.push(
      'Active accounts that have not yet paid out are not proven zero-payout outcomes. Their ' +
        'expected obligation is included above and should not be treated as earned margin.',
    );
  }

  return {
    expectedPayoutCost,
    grossMarginPerSale,
    contributionPerSale,
    contributionAfterAcquisition,
    monthlyContribution,
    monthlyProfit,
    breakEvenSalesPerMonth,
    breakEvenPayoutProbabilityBps,
    expectedOutstandingObligation,
    runoffMonths,
    warnings,
  };
}

/**
 * The reference scenario from the brief, reproduced exactly.
 *
 * $50K at $449.25 after the coupon, $120 lifetime variable costs, a 30% payout
 * probability and a $1,000 conditional average payout gives $29.25 of
 * contribution before fixed overhead. At 33.3% it is negative.
 *
 * These are ASSUMPTIONS for modelling, not forecasts and not industry figures.
 */
export const REFERENCE_SCENARIO_NOTE =
  'Reference figures are assumptions for modelling only. They are not forecasts, not industry ' +
  'benchmarks, and not observed results from this business.';
