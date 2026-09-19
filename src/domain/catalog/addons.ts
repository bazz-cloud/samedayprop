/**
 * Optional add-on catalog.
 *
 * OWNER DECISION, 2026-09-19: there are two add-ons and both change the RISK
 * TERMS of the account — a larger daily loss limit, and two more contracts of
 * position. The three earlier candidates (journal kit, analytics, guided setup)
 * are withdrawn.
 *
 * That makes these a different kind of product from the ones they replace, and
 * two consequences are handled rather than glossed:
 *
 *  1. THEY MUST REACH THE RISK ENGINE. A journal PDF that never shipped was a
 *     refund; a daily loss limit that says $892.50 on the receipt and enforces
 *     $595 on the server is a broken promise about money. The purchased deltas
 *     are written onto the trading account at provisioning and the engine reads
 *     the effective figures, never the plan's base ones.
 *  2. NEITHER ONE BUYS A BETTER OUTCOME. More daily room and more size both
 *     raise variance; they do not raise the drawdown allowance, the payout
 *     split, the daily cash cap or the lifetime cap, and more size reaches the
 *     drawdown threshold faster as readily as it reaches a profit. The
 *     descriptions say so, because an "upgrade" that quietly shortens the
 *     average account life would be the most cynical thing on the site.
 *
 * Prices are PER PLAN, not flat: two extra contracts on a $25,000 account is a
 * different product from two extra on a $300,000 account, and one price across
 * a twelve-fold range would be wrong at both ends.
 *
 * Design constraint carried through the whole system: no add-on may gate normal
 * account access, rule visibility, payout eligibility, basic statistics, basic
 * exports, account security, or ordinary support.
 */

import { Money, usd } from '../money/money';
import { proposed, type Governed } from '../config/requirement-status';
import type { PlanKey } from './plans';

export type AddOnKey = 'DAILY_LOSS_UPLIFT' | 'EXTRA_CONTRACTS';

export type AddOnDelivery =
  /** Instant digital download, no ongoing obligation. */
  | { readonly kind: 'download' }
  /** Time-boxed entitlement that expires. Explicitly does NOT auto-renew. */
  | { readonly kind: 'timed-entitlement'; readonly days: number }
  /** Requires a real human slot; may not be charged without confirmed capacity. */
  | { readonly kind: 'scheduled-session'; readonly minutes: number }
  /** Applied to the account's risk limits when it is provisioned. */
  | { readonly kind: 'risk-parameter' };

/**
 * What an add-on does to the account's enforced limits.
 *
 * A discriminated union rather than a bag of optional numbers, so adding a new
 * effect forces every consumer — provisioning, the risk engine, the dashboard —
 * to say what it does with it instead of silently ignoring it.
 */
export type AddOnEffect =
  /** Raises the daily loss limit by this percentage of the plan's figure. */
  | { readonly kind: 'daily-loss-uplift'; readonly percentOfBase: bigint }
  /** Raises the position ceiling by this many minis (and ten times as many micros). */
  | { readonly kind: 'extra-contracts'; readonly extraMinis: number };

export interface AddOnDefinition {
  readonly key: AddOnKey;
  readonly name: string;
  readonly description: string;
  /**
   * The plain statement of what it does NOT do. Shown next to the price, not
   * buried in terms: both of these add-ons raise variance, and a buyer who
   * thinks they are buying a better chance of a payout has been misled.
   */
  readonly limitation: string;
  /** One-time price per plan. Larger accounts pay more for the same uplift. */
  readonly listPriceByPlan: Governed<Readonly<Record<PlanKey, Money>>>;
  readonly delivery: AddOnDelivery;
  readonly effect: AddOnEffect;
  /**
   * True when the add-on cannot be charged until capacity is confirmed to exist.
   * Enforced server-side in the checkout service, not merely in the UI.
   */
  readonly requiresCapacityCheck: boolean;
  /** Eligible for the percentage coupon. */
  readonly couponEligible: boolean;
}

const OWNER_SCOPE = 'Owner decision 2026-09-19 — two risk add-ons; prices await approval';

export const ADDONS: readonly AddOnDefinition[] = [
  {
    key: 'DAILY_LOSS_UPLIFT',
    name: 'Bigger daily loss limit',
    description:
      'Raises the daily loss limit by 50% for the life of the account, so a bad session locks ' +
      'you out later than it otherwise would.',
    limitation:
      'It does not change your trailing drawdown, your payout caps or your split. A larger ' +
      'daily allowance means a larger single-day loss is possible, so it can reach the drawdown ' +
      'threshold sooner rather than later.',
    listPriceByPlan: proposed(
      {
        SIM_25K: usd('49.00'),
        SIM_50K: usd('79.00'),
        SIM_100K: usd('129.00'),
        SIM_150K: usd('179.00'),
        SIM_300K: usd('249.00'),
      },
      'Prices for the daily-loss uplift are drafted and await owner approval.',
      OWNER_SCOPE,
    ),
    delivery: { kind: 'risk-parameter' },
    effect: { kind: 'daily-loss-uplift', percentOfBase: 50n },
    requiresCapacityCheck: false,
    couponEligible: true,
  },
  {
    key: 'EXTRA_CONTRACTS',
    name: 'Two more contracts',
    description:
      'Raises the position ceiling by two minis, or twenty micros, for the life of the account.',
    limitation:
      'It does not change your drawdown allowance, your daily loss limit or your payout caps. ' +
      'The same move in bigger size reaches your threshold in fewer ticks.',
    listPriceByPlan: proposed(
      {
        SIM_25K: usd('69.00'),
        SIM_50K: usd('99.00'),
        SIM_100K: usd('169.00'),
        SIM_150K: usd('229.00'),
        SIM_300K: usd('329.00'),
      },
      'Prices for the extra-contracts add-on are drafted and await owner approval.',
      OWNER_SCOPE,
    ),
    delivery: { kind: 'risk-parameter' },
    effect: { kind: 'extra-contracts', extraMinis: 2 },
    requiresCapacityCheck: false,
    couponEligible: true,
  },
];

const ADDONS_BY_KEY = new Map<AddOnKey, AddOnDefinition>(ADDONS.map((a) => [a.key, a]));

export function getAddOn(key: AddOnKey): AddOnDefinition {
  const addon = ADDONS_BY_KEY.get(key);
  if (!addon) throw new Error(`Unknown add-on ${key}`);
  return addon;
}

export function isAddOnKey(value: string): value is AddOnKey {
  return ADDONS_BY_KEY.has(value as AddOnKey);
}

/** The one-time price of an add-on on a given plan. */
export function addOnPrice(addon: AddOnDefinition, planKey: PlanKey): Money {
  const price = addon.listPriceByPlan.value[planKey];
  if (!price) throw new Error(`Add-on ${addon.key} has no price for plan ${planKey}`);
  return price;
}

/**
 * The deltas a set of purchased add-ons applies to an account's limits.
 *
 * Returned as plain numbers so provisioning can store them and the risk engine
 * can add them back without either one re-reading the catalog: the account
 * carries what was bought, the way every other agreed term is snapshotted.
 */
export interface AddOnRiskDeltas {
  /** Percentage points of the plan's daily loss limit to add. */
  readonly dailyLossUpliftPercent: bigint;
  readonly extraMinis: number;
}

export function riskDeltasFor(keys: readonly AddOnKey[]): AddOnRiskDeltas {
  let dailyLossUpliftPercent = 0n;
  let extraMinis = 0;
  for (const key of keys) {
    const { effect } = getAddOn(key);
    switch (effect.kind) {
      case 'daily-loss-uplift':
        dailyLossUpliftPercent += effect.percentOfBase;
        break;
      case 'extra-contracts':
        extraMinis += effect.extraMinis;
        break;
    }
  }
  return { dailyLossUpliftPercent, extraMinis };
}

/**
 * Apply purchased deltas to a plan's base limits.
 *
 * The single place effective limits are computed. Ten micros to a mini, matching
 * the position ceiling everywhere else in the system.
 */
export function applyRiskDeltas(
  base: { dailyLossLimit: Money; ceilingMinis: number; ceilingMicros: number },
  deltas: AddOnRiskDeltas,
): { dailyLossLimit: Money; ceilingMinis: number; ceilingMicros: number } {
  return {
    dailyLossLimit: base.dailyLossLimit.plus(
      base.dailyLossLimit.mulRatio(deltas.dailyLossUpliftPercent, 100n, 'half-up'),
    ),
    ceilingMinis: base.ceilingMinis + deltas.extraMinis,
    ceilingMicros: base.ceilingMicros + deltas.extraMinis * 10,
  };
}

/**
 * Capabilities that are always included with any account and can never be moved
 * behind a paid add-on. Asserted by tests so a future catalog edit cannot
 * quietly paywall payout eligibility or basic statistics.
 */
export const ALWAYS_INCLUDED_CAPABILITIES = [
  'basic-account-statistics',
  'rules-access',
  'payout-eligibility',
  'payout-request',
  'basic-csv-export',
  'account-security',
  'standard-support',
  'signed-document-download',
  'receipts',
] as const;

export type IncludedCapability = (typeof ALWAYS_INCLUDED_CAPABILITIES)[number];
