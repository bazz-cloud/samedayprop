/**
 * Policy drafts.
 *
 * The point of these assertions is not the wording — it is that an unapproved
 * policy can never be presented as a binding rule, and that the two policies
 * carrying real financial exposure keep saying what they need to say.
 */
import { describe, expect, it } from 'vitest';
import {
  POLICY_DRAFTS,
  getPolicyDraft,
  policiesBlockProductionSale,
  policiesNeedingLegalReview,
} from '@/domain/policy/policies';

describe('policy drafts', () => {
  it('covers all ten policies that previously had no default', () => {
    expect(POLICY_DRAFTS.map((p) => p.value.key).sort()).toEqual([
      'AUTOMATION',
      'CLOSURE',
      'CONDUCT',
      'COPY_TRADING',
      'ELIGIBILITY',
      'HEDGING',
      'INACTIVITY',
      'NEWS_TRADING',
      'REFUNDS',
      'RESETS',
    ]);
  });

  it('is entirely unapproved, and says so by blocking production sale', () => {
    expect(POLICY_DRAFTS.every((p) => p.status === 'PROPOSED')).toBe(true);
    expect(policiesBlockProductionSale()).toBe(true);
  });

  it('gives every policy a one-line summary and at least three provisions', () => {
    for (const { value } of POLICY_DRAFTS) {
      expect(value.summary.length).toBeGreaterThan(0);
      expect(value.summary).not.toContain('\n');
      expect(value.rules.length).toBeGreaterThanOrEqual(3);
      expect(value.rationale.length).toBeGreaterThan(0);
    }
  });

  it('flags the three that law settles, not commercial preference', () => {
    expect(policiesNeedingLegalReview().map((p) => p.value.key).sort()).toEqual([
      'CONDUCT',
      'ELIGIBILITY',
      'REFUNDS',
    ]);
  });
});

describe('the policies carrying financial exposure', () => {
  it('prohibits cross-account hedging outright, not conditionally', () => {
    // Two accounts on opposite sides pays real cash on simulated performance
    // whichever way the market goes. This one cannot soften into "with limits".
    expect(getPolicyDraft('HEDGING').value.stance).toBe('PROHIBITED');
  });

  it('never lets a reset restore lifetime payout capacity', () => {
    const rules = getPolicyDraft('RESETS').value.rules.join(' ');
    expect(rules).toMatch(/does not restore lifetime payout capacity/i);
    expect(rules).toMatch(/[Bb]uy a new account/);
  });

  it('commits to giving a reason and an appeal before closing an account', () => {
    const rules = getPolicyDraft('CONDUCT').value.rules.join(' ');
    expect(rules).toMatch(/appeal/i);
    expect(rules).toMatch(/was not part of the original decision/i);
  });
});
