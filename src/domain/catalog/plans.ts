/**
 * Account plan catalog.
 *
 * This file is the single source of truth for what an account costs and which
 * rules it carries. It is consumed by the pricing engine, the risk engine, the
 * payout engine, the public site, and the admin console — the UI never carries
 * its own copy of a price or a limit.
 *
 * Statuses matter as much as the numbers. Prices, position ceilings, every risk
 * parameter and the lifetime payout caps are now CONFIRMED by the owner. The
 * few remaining PROPOSED values are derived controls introduced during
 * implementation rather than commercial terms — the trailing stop offset, the
 * whole-dollar withdrawal increment and the post-withdrawal room.
 * `planLaunchBlockers()` turns that into an enforceable gate.
 */

import { Money, usd } from '../money/money';
import {
  confirmed,
  proposed,
  unresolved,
  type Governed,
  type LifetimeCapPolicy,
  lifetimeCapBlocksProductionSale,
} from '../config/requirement-status';

export type PlanKey = 'SIM_25K' | 'SIM_50K' | 'SIM_100K' | 'SIM_150K' | 'SIM_300K';

export interface PositionCeiling {
  /** Maximum simultaneous mini contracts. */
  readonly minis: number;
  /** Maximum simultaneous micro contracts. */
  readonly micros: number;
}

export interface PlanDefinition {
  readonly key: PlanKey;
  /** Marketing label, e.g. "$50,000". */
  readonly label: string;
  /** Nominal SIMULATED account size. This is not a cash balance. */
  readonly startingBalance: Money;
  /** One-time list price. Not a subscription. */
  readonly listPrice: Governed<Money>;

  readonly positionCeiling: Governed<PositionCeiling>;
  /** Intraday trailing drawdown allowance (D in the trailing formula). */
  readonly drawdownAllowance: Governed<Money>;
  /** Maximum session trading loss before positions flatten and trading pauses. */
  readonly dailyLossLimit: Governed<Money>;
  /** Profit that must remain in the account above the starting balance. */
  readonly retainedBuffer: Governed<Money>;
  /** Maximum real CASH paid to the trader per day (gross withdrawal is 2x this). */
  readonly dailyCashPayoutCap: Governed<Money>;
  /** Lifetime CASH cap decision. Never a bare nullable number — see requirement-status.ts. */
  readonly lifetimeCashCap: LifetimeCapPolicy;
}

/** Trailing threshold stops rising once it reaches starting balance + this. */
export const TRAILING_STOP_OFFSET: Governed<Money> = proposed(
  usd('100.00'),
  'Trailing threshold stops at starting balance + $100, locking in a small buffer. ' +
    'Keep configurable and versioned; approval required before production sale.',
  'Build prompt §2 proposed defaults',
);

/** Trader share of eligible rewards. CONFIRMED at 50%. */
export const TRADER_SHARE_NUMERATOR = 1n;
export const TRADER_SHARE_DENOMINATOR = 2n;

/** Minimum GROSS withdrawal. CONFIRMED: $500 gross pays $250 cash. */
export const MINIMUM_GROSS_WITHDRAWAL: Governed<Money> = confirmed(
  usd('500.00'),
  'Minimum gross withdrawal of $500, paying $250 cash to the trader.',
  'Build prompt §2 confirmed',
);

/**
 * Gross withdrawals must be a whole-dollar multiple.
 *
 * This guarantees the 50/50 split never produces a fractional cent — a $500.01
 * gross request would owe $250.005 — so `Money.halfExact()` can stay exact
 * rather than silently rounding a real cash obligation.
 */
export const GROSS_WITHDRAWAL_INCREMENT: Governed<Money> = proposed(
  usd('1.00'),
  'Whole-dollar gross increments keep the 50/50 cash split free of fractional cents.',
  'Derived control, see docs/PAYOUT_AND_RISK_RULES.md §4',
);

/**
 * Equity must remain strictly ABOVE the trailing threshold after a withdrawal:
 * equity touching the threshold is itself a breach, so a payout may not be the
 * thing that trips it.
 */
export const MIN_POST_WITHDRAWAL_ROOM: Governed<Money> = proposed(
  usd('0.01'),
  'Post-withdrawal equity must exceed the trailing threshold by at least this much.',
  'Derived control, see docs/PAYOUT_AND_RISK_RULES.md §4',
);

const CONFIRMED_PRICE = 'Build prompt §2 confirmed price table';
const APPROVED_RISK = 'Owner-approved risk parameters, 2026-09-19';

/**
 * Lifetime cash payout cap: six times the account's daily cash payout cap.
 *
 * The owner approved the MULTIPLE, not five separate figures, so the cap is
 * derived rather than written down per plan. Change a daily cash cap and the
 * lifetime cap follows it, which is the point: two numbers that are meant to
 * stay in proportion cannot drift apart in a hand-edited table.
 *
 * Reaching the cap exhausts the account permanently. A reset does not restore
 * consumed capacity — see `resetPreservesLifetimeCapacity` below — so the only
 * way to keep earning is to buy a new account. That asymmetry is deliberate:
 * if the cheapest reset in the catalog cleared the cap, per-customer exposure
 * would be unbounded at reset prices.
 */
export const LIFETIME_CAP_MULTIPLE_OF_DAILY_CASH_CAP = 6n;

const LIFETIME_CAP_APPROVAL = {
  approvedBy: 'Owner',
  approvedAt: '2026-09-19',
} as const;

function approvedLifetimeCap(dailyCashCap: Money): LifetimeCapPolicy {
  return {
    kind: 'approved-amount',
    amountMinor: dailyCashCap.timesInt(Number(LIFETIME_CAP_MULTIPLE_OF_DAILY_CASH_CAP)).minor,
    ...LIFETIME_CAP_APPROVAL,
  };
}

/**
 * A reset restores balance, high-water mark and threshold. It does NOT restore
 * consumed lifetime payout capacity. Stated here as a named constant because it
 * is the load-bearing assumption behind the cap meaning anything at all.
 */
export const resetPreservesLifetimeCapacity = true;

type PlanWithoutDerivedCap = Omit<PlanDefinition, 'lifetimeCashCap'>;

const RAW_PLANS: readonly PlanWithoutDerivedCap[] = [
  {
    key: 'SIM_25K',
    label: '$25,000',
    startingBalance: usd('25000.00'),
    listPrice: confirmed(usd('349.00'), 'One-time purchase, not a subscription.', CONFIRMED_PRICE),
    positionCeiling: confirmed({ minis: 2, micros: 20 }, undefined, CONFIRMED_PRICE),
    drawdownAllowance: confirmed(usd('900.00'), undefined, APPROVED_RISK),
    dailyLossLimit: confirmed(usd('340.00'), undefined, APPROVED_RISK),
    retainedBuffer: confirmed(usd('1000.00'), undefined, APPROVED_RISK),
    dailyCashPayoutCap: confirmed(
      usd('1000.00'),
      'Starting daily cash payout cap of $1,000 (equivalent to $2,000 gross).',
      'Build prompt §2 confirmed',
    ),
  },
  {
    key: 'SIM_50K',
    label: '$50,000',
    startingBalance: usd('50000.00'),
    listPrice: confirmed(usd('599.00'), 'One-time purchase, not a subscription.', CONFIRMED_PRICE),
    positionCeiling: confirmed({ minis: 4, micros: 40 }, undefined, CONFIRMED_PRICE),
    drawdownAllowance: confirmed(usd('1800.00'), undefined, APPROVED_RISK),
    dailyLossLimit: confirmed(usd('595.00'), undefined, APPROVED_RISK),
    retainedBuffer: confirmed(usd('2000.00'), undefined, APPROVED_RISK),
    dailyCashPayoutCap: confirmed(usd('1500.00'), undefined, APPROVED_RISK),
  },
  {
    key: 'SIM_100K',
    label: '$100,000',
    startingBalance: usd('100000.00'),
    listPrice: confirmed(usd('999.00'), 'One-time purchase, not a subscription.', CONFIRMED_PRICE),
    positionCeiling: confirmed({ minis: 6, micros: 60 }, undefined, CONFIRMED_PRICE),
    drawdownAllowance: confirmed(usd('2700.00'), undefined, APPROVED_RISK),
    dailyLossLimit: confirmed(usd('850.00'), undefined, APPROVED_RISK),
    retainedBuffer: confirmed(usd('3000.00'), undefined, APPROVED_RISK),
    dailyCashPayoutCap: confirmed(usd('2500.00'), undefined, APPROVED_RISK),
  },
  {
    key: 'SIM_150K',
    label: '$150,000',
    startingBalance: usd('150000.00'),
    listPrice: confirmed(usd('1499.00'), 'One-time purchase, not a subscription.', CONFIRMED_PRICE),
    positionCeiling: confirmed({ minis: 10, micros: 100 }, undefined, CONFIRMED_PRICE),
    drawdownAllowance: confirmed(usd('4050.00'), undefined, APPROVED_RISK),
    dailyLossLimit: confirmed(usd('1275.00'), undefined, APPROVED_RISK),
    retainedBuffer: confirmed(usd('4500.00'), undefined, APPROVED_RISK),
    dailyCashPayoutCap: confirmed(usd('3000.00'), undefined, APPROVED_RISK),
  },
  {
    key: 'SIM_300K',
    label: '$300,000',
    startingBalance: usd('300000.00'),
    listPrice: confirmed(usd('2499.00'), 'One-time purchase, not a subscription.', CONFIRMED_PRICE),
    positionCeiling: confirmed(
      { minis: 15, micros: 150 },
      undefined,
      'Owner-approved 2026-09-19. Interpolated from the confirmed sizes, then confirmed as-is.',
    ),
    drawdownAllowance: confirmed(usd('6750.00'), undefined, APPROVED_RISK),
    dailyLossLimit: confirmed(usd('2125.00'), undefined, APPROVED_RISK),
    retainedBuffer: confirmed(usd('7500.00'), undefined, APPROVED_RISK),
    dailyCashPayoutCap: confirmed(usd('4000.00'), undefined, APPROVED_RISK),
  },
];

/**
 * The cap is attached here rather than written into each plan above, so it is
 * structurally impossible for a plan's lifetime cap to disagree with the daily
 * cash cap it is defined as a multiple of.
 */
export const PLANS: readonly PlanDefinition[] = RAW_PLANS.map((plan) => ({
  ...plan,
  lifetimeCashCap: approvedLifetimeCap(plan.dailyCashPayoutCap.value),
}));

const PLANS_BY_KEY = new Map<PlanKey, PlanDefinition>(PLANS.map((p) => [p.key, p]));

export function getPlan(key: PlanKey): PlanDefinition {
  const plan = PLANS_BY_KEY.get(key);
  if (!plan) throw new Error(`Unknown plan ${key}`);
  return plan;
}

export function isPlanKey(value: string): value is PlanKey {
  return PLANS_BY_KEY.has(value as PlanKey);
}

/** Price after the 25% coupon, computed exactly (no float percentage). */
export function couponPrice(listPrice: Money, percentOff: bigint): Money {
  return listPrice.minus(listPrice.mulRatio(percentOff, 100n, 'half-up'));
}

export interface LaunchBlocker {
  readonly field: string;
  readonly status: string;
  readonly detail: string;
}

/**
 * Reasons this plan may not be sold in PRODUCTION.
 *
 * Demo mode renders the plan with a demo banner; production checkout refuses
 * the order outright. An empty array means every commercially material term on
 * this plan has been confirmed.
 */
export function planLaunchBlockers(plan: PlanDefinition): LaunchBlocker[] {
  const blockers: LaunchBlocker[] = [];

  const gated: [string, Governed<unknown>][] = [
    ['listPrice', plan.listPrice],
    ['positionCeiling', plan.positionCeiling],
    ['drawdownAllowance', plan.drawdownAllowance],
    ['dailyLossLimit', plan.dailyLossLimit],
    ['retainedBuffer', plan.retainedBuffer],
    ['dailyCashPayoutCap', plan.dailyCashPayoutCap],
  ];

  for (const [field, governed] of gated) {
    if (governed.status !== 'CONFIRMED') {
      blockers.push({
        field,
        status: governed.status,
        detail: governed.note ?? `${field} is ${governed.status} and requires owner approval.`,
      });
    }
  }

  if (lifetimeCapBlocksProductionSale(plan.lifetimeCashCap)) {
    blockers.push({
      field: 'lifetimeCashCap',
      status: 'UNRESOLVED',
      detail:
        plan.lifetimeCashCap.kind === 'unresolved'
          ? plan.lifetimeCashCap.note
          : 'Lifetime cash payout cap is unresolved.',
    });
  }

  if (TRAILING_STOP_OFFSET.status !== 'CONFIRMED') {
    blockers.push({
      field: 'trailingStopOffset',
      status: TRAILING_STOP_OFFSET.status,
      detail: TRAILING_STOP_OFFSET.note ?? 'Trailing stop policy requires approval.',
    });
  }

  return blockers;
}

export function isPlanSellableInProduction(plan: PlanDefinition): boolean {
  return planLaunchBlockers(plan).length === 0;
}
