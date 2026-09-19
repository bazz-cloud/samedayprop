/**
 * Customer email templates.
 *
 * These assert the things that would be expensive to get wrong: that a breach
 * email names which limit and what the figures were, that nothing promises when
 * money arrives, and that no template ever carries a password.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as templates from '@/server/email/templates';
import { TEMPLATE_NAMES } from '@/server/email/templates';

const company = {
  name: 'Bull Rush Futures',
  supportEmail: 'support@example.invalid',
  baseUrl: 'https://example.invalid',
};

const base = { company, to: 'trader@example.invalid', name: 'Dana Reyes' };

const all = () => [
  templates.accountPurchased({ ...base, planLabel: '$50,000', amountPaid: '$449.25', orderReference: 'ord_1' }),
  templates.credentialsIssued({ ...base, planLabel: '$50,000', username: 'BRF-123' }),
  templates.dailyLossLockout({
    ...base, planLabel: '$50,000', dailyLossLimit: '$595.00',
    sessionLoss: '-$595.00', reopensAt: '18:00 ET today',
  }),
  templates.accountBreached({
    ...base, planLabel: '$50,000', breachType: 'TRAILING', equityAtBreach: '$48,200.00',
    thresholdAtBreach: '$48,200.00', occurredAt: '2026-09-19 14:32 ET', resetPrice: '$439.25',
  }),
  templates.payoutRequested({ ...base, grossAmount: '$500.00', cashAmount: '$250.00', requestReference: 'pay_1' }),
  templates.payoutPaid({
    ...base, cashAmount: '$250.00', requestReference: 'pay_1',
    sentAt: '2026-09-19', remainingLifetimeCap: '$8,750.00',
  }),
  templates.inactivityWarning({ ...base, planLabel: '$50,000', daysInactive: 60, closesOn: '2026-12-18' }),
  templates.resetPurchased({
    ...base, planLabel: '$50,000', amountPaid: '$439.25',
    restoredBalance: '$50,000.00', remainingLifetimeCap: '$8,750.00',
  }),
];

describe('every template', () => {
  it('covers each name in the manifest', () => {
    expect(all()).toHaveLength(TEMPLATE_NAMES.length);
    for (const name of TEMPLATE_NAMES) {
      expect(typeof (templates as Record<string, unknown>)[name]).toBe('function');
    }
  });

  it('has a subject, a plain-text body, and the recipient', () => {
    for (const email of all()) {
      expect(email.to).toBe('trader@example.invalid');
      expect(email.subject.length).toBeGreaterThan(5);
      expect(email.subject).not.toMatch(/\n/);
      expect(email.bodyText.length).toBeGreaterThan(100);
    }
  });

  it('never carries a password, secret or token', () => {
    // A password in a mailbox is a password in the hands of everyone who reads
    // it. What this looks for is a VALUE after the label — "password: hunter2"
    // — not the word itself, because the credentials email has to say that the
    // password is deliberately absent.
    const leak = /(password|secret|token|api[ _-]?key)\s*(?:is|:|=)\s*(?!not\b)[^\s.]/i;
    for (const email of all()) {
      expect(email.bodyText).not.toMatch(leak);
    }
  });

  it('is structurally incapable of carrying a password', () => {
    // The stronger guarantee: no template takes one. Passing a secret through
    // would not compile, so this cannot regress by someone editing copy.
    const source = readFileSync(join(__dirname, '../src/server/email/templates.ts'), 'utf8');
    const inputFields = source.match(/readonly\s+\w+|^\s+\w+:\s/gm) ?? [];
    expect(inputFields.some((f) => /password|secret|apiKey/i.test(f))).toBe(false);
  });

  it('carries the simulated-trading disclosure in every footer', () => {
    for (const email of all()) {
      expect(email.bodyText).toContain('All trading in this program is simulated');
      expect(email.bodyText).toContain('You can lose the fee you pay and receive nothing');
    }
  });

  it('makes no earnings claim and no guarantee', () => {
    for (const email of all()) {
      expect(email.bodyText).not.toMatch(/\bguarantee(d|s)?\b(?! that cash| when)/i);
      expect(email.bodyText).not.toMatch(/\brisk[- ]free\b/i);
      expect(email.bodyText).not.toMatch(/\bfunded trader\b/i);
      expect(email.bodyText).not.toMatch(/\bearn \$/i);
    }
  });
});

describe('credentials email', () => {
  const email = templates.credentialsIssued({ ...base, planLabel: '$50,000', username: 'BRF-123' });

  it('gives the username but explains why the password is absent', () => {
    expect(email.bodyText).toContain('BRF-123');
    expect(email.bodyText).toContain('Your password is NOT in this email');
    expect(email.bodyText).toContain('keep only a hash');
  });

  it('warns that nobody will ask for the password', () => {
    expect(email.bodyText).toContain('will ever ask you for your password');
  });
});

describe('breach email', () => {
  it('names which limit was hit, with the figures', () => {
    const trailing = templates.accountBreached({
      ...base, planLabel: '$50,000', breachType: 'TRAILING', equityAtBreach: '$48,200.00',
      thresholdAtBreach: '$48,200.00', occurredAt: 'then', resetPrice: '$439.25',
    });
    expect(trailing.bodyText).toContain('trailing drawdown threshold');
    expect(trailing.bodyText).toContain('$48,200.00');
    // Naming figures is the difference between a notice and a dispute.
    expect(trailing.bodyText).toContain('touching the threshold is a breach');
  });

  it('states that the fee is not refunded and a reset does not restore capacity', () => {
    const email = templates.accountBreached({
      ...base, planLabel: '$50,000', breachType: 'DAILY_LOSS', equityAtBreach: '$1',
      thresholdAtBreach: '$1', occurredAt: 'then', resetPrice: '$439.25',
    });
    expect(email.bodyText).toContain('not refunded');
    expect(email.bodyText).toMatch(/does NOT restore payout capacity/);
  });

  it('invites a challenge rather than presenting the decision as final', () => {
    const email = templates.accountBreached({
      ...base, planLabel: '$50,000', breachType: 'TRAILING', equityAtBreach: '$1',
      thresholdAtBreach: '$1', occurredAt: 'then', resetPrice: '$439.25',
    });
    expect(email.bodyText).toMatch(/if you think this[\s\S]*is wrong/i);
  });
});

describe('payout emails', () => {
  it('never promises when the money arrives', () => {
    const requested = templates.payoutRequested({
      ...base, grossAmount: '$500.00', cashAmount: '$250.00', requestReference: 'p1',
    });
    const paid = templates.payoutPaid({
      ...base, cashAmount: '$250.00', requestReference: 'p1', sentAt: 'today',
      remainingLifetimeCap: null,
    });
    expect(requested.bodyText).toContain('cannot promise when the money lands');
    expect(paid.bodyText).toContain('Sent is not the same as arrived');
    for (const email of [requested, paid]) {
      expect(email.bodyText).not.toMatch(/same[- ]day (receipt|arrival)/i);
      expect(email.bodyText).not.toMatch(/will arrive (today|within)/i);
    }
  });

  it('explains where the other half of a gross withdrawal goes', () => {
    const email = templates.payoutRequested({
      ...base, grossAmount: '$500.00', cashAmount: '$250.00', requestReference: 'p1',
    });
    expect(email.bodyText).toContain('ceases to exist');
  });

  it('omits the capacity line when there is no cap to report', () => {
    const email = templates.payoutPaid({
      ...base, cashAmount: '$250.00', requestReference: 'p1', sentAt: 'today',
      remainingLifetimeCap: null,
    });
    expect(email.bodyText).not.toContain('Remaining lifetime payout capacity');
  });
});

describe('lockout email', () => {
  it('distinguishes a pause from a breach', () => {
    const email = templates.dailyLossLockout({
      ...base, planLabel: '$50,000', dailyLossLimit: '$595.00',
      sessionLoss: '-$595.00', reopensAt: '18:00 ET',
    });
    expect(email.bodyText).toContain('This is a pause, not a breach');
    expect(email.bodyText).toContain('no reset is needed');
    // The rule people most often get wrong about their own account.
    expect(email.bodyText).toContain('Withdrawals are not counted as trading losses');
  });
});

describe('reset email', () => {
  it('says plainly that used payout capacity does not come back', () => {
    const email = templates.resetPurchased({
      ...base, planLabel: '$50,000', amountPaid: '$439.25',
      restoredBalance: '$50,000.00', remainingLifetimeCap: '$8,750.00',
    });
    expect(email.bodyText).toMatch(/was NOT restored/);
  });
});
