/**
 * Financial stress model.
 *
 * Answers one question: at what payout rate does each account tier stop making
 * money, and how far is that from what the industry actually sees?
 *
 * EVERY industry figure here is EXTERNAL — sourced from published aggregators,
 * not from our own data, which does not exist yet. They are marked as such and
 * carry their source, because a model is only as honest as its inputs and these
 * inputs are secondary reporting rather than audited filings.
 *
 * The model is deliberately simple. A Monte Carlo over invented return
 * distributions would look more sophisticated and mean less: the distribution
 * would be made up. Instead this computes break-even payout rates exactly, and
 * then asks what happens at multiples of the observed industry rate. Those are
 * numbers a decision can rest on.
 */

import type { PlanKey } from '@/domain/catalog/plans';

export interface IndustryFigure {
  readonly value: number;
  readonly note: string;
  readonly source: string;
}

/**
 * Published industry figures, September 2026.
 *
 * Caveats that matter when reading anything below:
 *  - These are blog and comparison-site aggregations, not audited numbers. Prop
 *    firms do not publish verified payout statistics.
 *  - Most describe EVALUATION firms. This business has no evaluation, so every
 *    buyer is funded on day one and the denominators differ.
 *  - Reported figures disagree with each other (62% blown in 45 days vs 87% in
 *    30 days). Both are kept rather than averaged, because averaging two
 *    incompatible definitions produces a number that measures nothing.
 */
export const INDUSTRY = {
  fundedAccountsReceivingPayout: {
    value: 0.07,
    note: 'Share of funded accounts that ever receive a payout.',
    source: 'quantvps.com/blog/prop-firm-statistics, tradersyard.com (2026)',
  },
  consistentlyPaidTraders: {
    value: 0.015,
    note: 'Traders who secure payouts consistently, 1-2%. Midpoint used.',
    source: 'phidiaspropfirm.com instant-funding analysis (2026)',
  },
  blownWithin45Days: {
    value: 0.62,
    note: 'Instant-funding accounts blown within 45 days.',
    source: 'phidiaspropfirm.com (2026)',
  },
  failuresFromDrawdown: {
    value: 0.7,
    note: 'Share of failures caused by hitting a drawdown limit rather than by missing a target.',
    source: 'quantvps.com/blog/prop-firm-statistics (2026)',
  },
  instantFundingDailyLossPct: {
    value: 0.04,
    note: 'Typical instant-funding daily loss limit, 3-5% of account size. Midpoint.',
    source: 'phidiaspropfirm.com, fortraders.com (2026)',
  },
  instantFundingDrawdownPct: {
    value: 0.065,
    note: 'Typical instant-funding max drawdown, 5-8% of account size. Midpoint.',
    source: 'phidiaspropfirm.com, fortraders.com (2026)',
  },
} as const satisfies Record<string, IndustryFigure>;

export interface TierInput {
  readonly planKey: PlanKey;
  readonly label: string;
  readonly startingBalanceMinor: bigint;
  readonly pricePaidMinor: bigint;
  readonly lifetimeCapMinor: bigint;
  readonly dailyLossLimitMinor: bigint;
  readonly drawdownAllowanceMinor: bigint;
  readonly dailyCashCapMinor: bigint;
}

export interface TierStress {
  readonly planKey: PlanKey;
  readonly label: string;
  readonly pricePaidMinor: bigint;
  readonly lifetimeCapMinor: bigint;
  /** Worst case per customer: cap ÷ price. */
  readonly exposureRatio: number;
  /**
   * The payout rate at which this tier breaks even, assuming a paying account
   * takes its FULL lifetime cap. The pessimistic bound — see partial variants.
   */
  readonly breakEvenRateAtFullCap: number;
  /** Break-even if a paying account takes only its first $500 gross ($250 cash). */
  readonly breakEvenRateAtMinimumPayout: number;
  /** Our daily loss limit as a share of account size. */
  readonly dailyLossPctOfAccount: number;
  /** Our drawdown allowance as a share of account size. */
  readonly drawdownPctOfAccount: number;
  /** How much tighter our drawdown is than the industry midpoint. Above 1 = tighter. */
  readonly drawdownTightnessVsIndustry: number;
}

const FIRST_PAYOUT_CASH_MINOR = 25_000n; // $250: half of the $500 gross minimum

export function analyseTier(tier: TierInput): TierStress {
  const price = Number(tier.pricePaidMinor);
  const cap = Number(tier.lifetimeCapMinor);
  const balance = Number(tier.startingBalanceMinor);

  return {
    planKey: tier.planKey,
    label: tier.label,
    pricePaidMinor: tier.pricePaidMinor,
    lifetimeCapMinor: tier.lifetimeCapMinor,
    exposureRatio: cap / price,
    // Revenue per account is `price`. Cost is `rate x payoutSize`. Break-even
    // is where they meet.
    breakEvenRateAtFullCap: price / cap,
    breakEvenRateAtMinimumPayout: price / Number(FIRST_PAYOUT_CASH_MINOR),
    dailyLossPctOfAccount: Number(tier.dailyLossLimitMinor) / balance,
    drawdownPctOfAccount: Number(tier.drawdownAllowanceMinor) / balance,
    drawdownTightnessVsIndustry:
      INDUSTRY.instantFundingDrawdownPct.value / (Number(tier.drawdownAllowanceMinor) / balance),
  };
}

export interface CohortScenario {
  readonly name: string;
  /** Share of accounts that ever take a payout. */
  readonly payoutRate: number;
  /** Average cash taken by a paying account, as a share of its lifetime cap. */
  readonly capUtilisation: number;
}

/**
 * Scenarios, from the industry rate outward.
 *
 * Utilisation is the assumption with no published source, so it is varied
 * rather than fixed: a payer who takes the $500 minimum once and a payer who
 * exhausts a $6,000 cap are both "a payer", and the difference between them is
 * 24x. Anyone reading the output should treat utilisation as the number to
 * argue about.
 */
export const SCENARIOS: readonly CohortScenario[] = [
  { name: 'Industry rate, light usage', payoutRate: 0.07, capUtilisation: 0.15 },
  { name: 'Industry rate, half cap', payoutRate: 0.07, capUtilisation: 0.5 },
  { name: 'Double industry rate, half cap', payoutRate: 0.14, capUtilisation: 0.5 },
  { name: 'Triple industry rate, half cap', payoutRate: 0.21, capUtilisation: 0.5 },
  { name: 'Industry rate, full cap', payoutRate: 0.07, capUtilisation: 1.0 },
  { name: 'Double rate, full cap', payoutRate: 0.14, capUtilisation: 1.0 },
  { name: 'Severe: 1 in 4 pays, full cap', payoutRate: 0.25, capUtilisation: 1.0 },
];

export interface CohortResult {
  readonly scenario: string;
  readonly accountsSold: number;
  readonly revenueMinor: bigint;
  readonly payingAccounts: number;
  readonly cashOutMinor: bigint;
  readonly netMinor: bigint;
  readonly marginPct: number;
}

/** What one tier does over a cohort of accounts under a scenario. */
export function runScenario(
  tier: TierInput,
  scenario: CohortScenario,
  accountsSold: number,
): CohortResult {
  const revenueMinor = tier.pricePaidMinor * BigInt(accountsSold);
  const payingAccounts = Math.round(accountsSold * scenario.payoutRate);
  // Integer arithmetic on the cap: utilisation is expressed in basis points so
  // no float multiplies a money figure.
  const utilisationBps = BigInt(Math.round(scenario.capUtilisation * 10_000));
  const cashPerPayerMinor = (tier.lifetimeCapMinor * utilisationBps) / 10_000n;
  const cashOutMinor = cashPerPayerMinor * BigInt(payingAccounts);
  const netMinor = revenueMinor - cashOutMinor;

  return {
    scenario: scenario.name,
    accountsSold,
    revenueMinor,
    payingAccounts,
    cashOutMinor,
    netMinor,
    marginPct: revenueMinor === 0n ? 0 : Number(netMinor) / Number(revenueMinor),
  };
}

/**
 * Cluster risk: what one copier across N accounts costs if it wins.
 *
 * Correlated accounts are not independent draws. A trader running the same
 * idea across five accounts either pays out on all five or none, so the firm's
 * variance is far higher than an account count suggests.
 */
export function clusterWorstCase(tier: TierInput, accountsInCluster: number): {
  readonly revenueMinor: bigint;
  readonly worstCaseCashMinor: bigint;
  readonly netMinor: bigint;
} {
  const revenueMinor = tier.pricePaidMinor * BigInt(accountsInCluster);
  const worstCaseCashMinor = tier.lifetimeCapMinor * BigInt(accountsInCluster);
  return { revenueMinor, worstCaseCashMinor, netMinor: revenueMinor - worstCaseCashMinor };
}
