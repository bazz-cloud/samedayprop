/**
 * Requirement provenance.
 *
 * Every commercially material number in this system carries a status so that a
 * PROPOSED development default can never quietly become a promise made to a
 * paying customer. The rule enforced throughout the app:
 *
 *   - CONFIRMED   the owner has committed to this. Sellable in production.
 *   - PROPOSED    a development default. Usable in demo mode with a banner;
 *                 BLOCKS production sale of any plan that depends on it.
 *   - EXTERNAL    depends on a third party (Tradovate, payment processor,
 *                 counsel). Blocks the capability it gates until verified.
 *   - UNRESOLVED  a decision the owner must actively make. Never defaulted.
 *
 * See docs/DECISIONS.md for the authoritative register.
 */

import { Money } from '@/domain/money/money';

export type RequirementStatus = 'CONFIRMED' | 'PROPOSED' | 'EXTERNAL' | 'UNRESOLVED';

export interface Governed<T> {
  readonly value: T;
  readonly status: RequirementStatus;
  /** Short human explanation shown in the admin setup checklist. */
  readonly note?: string;
  /** Where the value came from: an owner decision, a doc link, a spec section. */
  readonly source?: string;
}

export function confirmed<T>(value: T, note?: string, source?: string): Governed<T> {
  return { value, status: 'CONFIRMED', note, source };
}

export function proposed<T>(value: T, note?: string, source?: string): Governed<T> {
  return { value, status: 'PROPOSED', note, source };
}

export function external<T>(value: T, note?: string, source?: string): Governed<T> {
  return { value, status: 'EXTERNAL', note, source };
}

export function unresolved<T>(value: T, note?: string, source?: string): Governed<T> {
  return { value, status: 'UNRESOLVED', note, source };
}

/** True when the value is committed and may back a production sale. */
export function isSellable(g: Governed<unknown>): boolean {
  return g.status === 'CONFIRMED';
}

/**
 * The lifetime CASH payout cap is modelled as an explicit three-way decision
 * rather than a nullable number.
 *
 * The build prompt is emphatic on this point: a NULL cap must NOT silently mean
 * "approved, unlimited". An unbounded lifetime obligation is the single largest
 * financial exposure in this business model, so "no cap" has to be something
 * the owner affirmatively chose, with an audit trail.
 */
export type LifetimeCapPolicy =
  | {
      readonly kind: 'unresolved';
      /** Recommended-but-unapproved figure, seeded for modelling only. */
      readonly draftMinor: bigint;
      readonly note: string;
    }
  | {
      readonly kind: 'approved-amount';
      readonly amountMinor: bigint;
      readonly approvedBy: string;
      readonly approvedAt: string;
    }
  | {
      readonly kind: 'approved-uncapped';
      readonly approvedBy: string;
      readonly approvedAt: string;
      /** Free-text acknowledgement that the exposure is unbounded. */
      readonly acknowledgement: string;
    };

/** Remaining lifetime capacity, or null when the owner approved no cap. */
export function lifetimeCapAmountMinor(policy: LifetimeCapPolicy): bigint | null {
  switch (policy.kind) {
    case 'approved-amount':
      return policy.amountMinor;
    case 'approved-uncapped':
      return null;
    case 'unresolved':
      // Callers must check `blocksProductionSale` first. Falling back to the
      // draft here would be exactly the silent approval we are preventing.
      throw new Error(
        'Lifetime payout cap is UNRESOLVED. The owner must approve an amount or ' +
          'explicitly approve an uncapped policy before this plan can be sold.',
      );
  }
}

export function lifetimeCapBlocksProductionSale(policy: LifetimeCapPolicy): boolean {
  return policy.kind === 'unresolved';
}

export function describeLifetimeCap(policy: LifetimeCapPolicy): string {
  switch (policy.kind) {
    case 'approved-amount':
      return `${Money.fromMinor(policy.amountMinor).format()} lifetime cash payout cap`;
    case 'approved-uncapped':
      return 'No lifetime cash payout cap (explicitly approved)';
    case 'unresolved':
      return 'Lifetime cash payout cap not yet decided';
  }
}
