/**
 * Optional add-on catalog.
 *
 * These are CANDIDATE products, not committed features. The build prompt is
 * explicit that they must not be marketed until they can actually be delivered,
 * so every one of them is PROPOSED and therefore disabled in production until
 * the owner confirms price and delivery capability.
 *
 * Design constraint carried through the whole system: no add-on may gate normal
 * account access, rule visibility, payout eligibility, basic statistics, basic
 * exports, account security, or ordinary support.
 */

import { Money, usd } from '../money/money';
import { proposed, type Governed } from '../config/requirement-status';

export type AddOnKey = 'JOURNAL_KIT' | 'ADVANCED_ANALYTICS' | 'GUIDED_SETUP';

export type AddOnDelivery =
  /** Instant digital download, no ongoing obligation. */
  | { readonly kind: 'download' }
  /** Time-boxed entitlement that expires. Explicitly does NOT auto-renew. */
  | { readonly kind: 'timed-entitlement'; readonly days: number }
  /** Requires a real human slot; may not be charged without confirmed capacity. */
  | { readonly kind: 'scheduled-session'; readonly minutes: number };

export interface AddOnDefinition {
  readonly key: AddOnKey;
  readonly name: string;
  readonly description: string;
  readonly listPrice: Governed<Money>;
  readonly delivery: AddOnDelivery;
  /** Assumed cost to deliver one unit; feeds admin contribution reporting. */
  readonly assumedUnitCost: Governed<Money>;
  /**
   * True when the add-on cannot be charged until capacity is confirmed to exist.
   * Enforced server-side in the checkout service, not merely in the UI.
   */
  readonly requiresCapacityCheck: boolean;
  /** Eligible for the percentage coupon. */
  readonly couponEligible: boolean;
}

const CANDIDATE = 'Build prompt §4 — candidate product, price and delivery not committed';

export const ADDONS: readonly AddOnDefinition[] = [
  {
    key: 'JOURNAL_KIT',
    name: 'Trading Journal Kit',
    description:
      'Downloadable trading journal, session planner and review templates. One-time purchase.',
    listPrice: proposed(usd('19.00'), undefined, CANDIDATE),
    delivery: { kind: 'download' },
    assumedUnitCost: proposed(
      usd('0.50'),
      'Assumed hosting/bandwidth per delivery. Replace with measured cost.',
      CANDIDATE,
    ),
    requiresCapacityCheck: false,
    couponEligible: true,
  },
  {
    key: 'ADVANCED_ANALYTICS',
    name: 'Advanced Analytics',
    description:
      '30 days of custom tagging, session comparisons and advanced exports. Does not automatically renew.',
    listPrice: proposed(usd('29.00'), undefined, CANDIDATE),
    delivery: { kind: 'timed-entitlement', days: 30 },
    assumedUnitCost: proposed(
      usd('3.00'),
      'Assumed compute/storage for 30 days. Replace with measured cost.',
      CANDIDATE,
    ),
    requiresCapacityCheck: false,
    couponEligible: true,
  },
  {
    key: 'GUIDED_SETUP',
    name: 'Guided Setup',
    description:
      'One scheduled 20-minute platform walkthrough. Sold only while real scheduling capacity exists.',
    listPrice: proposed(usd('49.00'), undefined, CANDIDATE),
    delivery: { kind: 'scheduled-session', minutes: 20 },
    assumedUnitCost: proposed(
      usd('25.00'),
      'Assumed staff cost for a 20-minute session plus scheduling overhead.',
      CANDIDATE,
    ),
    requiresCapacityCheck: true,
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
