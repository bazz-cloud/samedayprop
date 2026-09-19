/**
 * Render every email template to docs/EMAIL_DRAFTS.md for review.
 *
 * Generated, never hand-edited: the file is the templates, so a review cannot
 * approve wording that the code does not actually send. Re-run after changing
 * src/server/email/templates.ts.
 */
import { writeFileSync } from 'node:fs';

// Run through tsx so the TypeScript templates import directly:
//   npx tsx scripts/render-emails.mjs
const t = await import('../src/server/email/templates.ts');

const company = {
  name: '[COMPANY LEGAL NAME]',
  supportEmail: '[SUPPORT EMAIL]',
  baseUrl: 'https://bullrushfutures.com',
};
const base = { company, to: 'trader@example.com', name: 'Dana Reyes' };

const emails = [
  ['Account purchased', 'After payment clears and the agreements are signed.',
    t.accountPurchased({ ...base, planLabel: '$50,000', amountPaid: '$449.25', orderReference: 'BRF-10428' })],
  ['Credentials issued', 'Once the account exists and its limits have been read back.',
    t.credentialsIssued({ ...base, planLabel: '$50,000', username: 'BRF-80D4D2DD' })],
  ['Daily loss lockout', 'When the daily loss limit pauses trading.',
    t.dailyLossLockout({ ...base, planLabel: '$50,000', dailyLossLimit: '$595.00', sessionLoss: '−$612.40', reopensAt: '18:00 ET today' })],
  ['Account breached', 'When a trailing or max drawdown breach ends the account.',
    t.accountBreached({ ...base, planLabel: '$50,000', breachType: 'TRAILING', equityAtBreach: '$48,200.00', thresholdAtBreach: '$48,200.00', occurredAt: '19 Sep 2026, 14:32 ET', resetPrice: '$439.25' })],
  ['Payout requested', 'On a valid payout request.',
    t.payoutRequested({ ...base, grossAmount: '$500.00', cashAmount: '$250.00', requestReference: 'PO-3391' })],
  ['Payout paid', 'When the cash has been sent.',
    t.payoutPaid({ ...base, cashAmount: '$250.00', requestReference: 'PO-3391', sentAt: '19 Sep 2026', remainingLifetimeCap: '$8,750.00' })],
  ['Inactivity warning', 'At 60 and again at 83 days without a trade.',
    t.inactivityWarning({ ...base, planLabel: '$50,000', daysInactive: 60, closesOn: '18 Dec 2026' })],
  ['Reset purchased', 'After a paid reset is applied.',
    t.resetPurchased({ ...base, planLabel: '$50,000', amountPaid: '$439.25', restoredBalance: '$50,000.00', remainingLifetimeCap: '$8,750.00' })],
];

const out = [
  '# Customer email drafts',
  '',
  '> GENERATED FILE. Do not edit by hand — edit `src/server/email/templates.ts`',
  '> and re-run `npx tsx scripts/render-emails.mjs`. This file is the templates, so',
  '> approving wording here approves what actually sends.',
  '',
  'Figures shown are examples. In a real message every one is computed from the',
  'same plan and account data the site renders, so an email cannot state a rule',
  'the engine does not enforce.',
  '',
  '`[COMPANY LEGAL NAME]` and `[SUPPORT EMAIL]` resolve from configuration and are',
  'placeholders until the company details are supplied.',
  '',
  '## What is deliberately absent',
  '',
  '- **No password, ever.** The credentials email carries the username and a link;',
  '  the secret is shown once in the dashboard and only a hash is kept. Two tests',
  '  enforce this, one of which checks no template can even accept a password.',
  '- **No arrival promise.** Payout mail says money was *sent*, never when it will',
  '  land. Eligibility is ours; settlement is the bank’s.',
  '- **No earnings claims, guarantees, or "funded trader" language.**',
  '- **No unsubscribe link.** These are transactional. Offering to unsubscribe',
  '  from a payout confirmation would be worse than useless.',
  '',
  '---',
  '',
];

for (const [title, when, email] of emails) {
  out.push(`## ${title}`, '', `*${when}*`, '', `**Subject:** ${email.subject}`, '');
  if (email.attachments?.length) {
    out.push(`**Attachments:** ${email.attachments.map((a) => `${a.filename} — ${a.description}`).join('; ')}`, '');
  }
  out.push('```text', email.bodyText, '```', '');
}

writeFileSync('docs/EMAIL_DRAFTS.md', out.join('\n'));
console.log(`Rendered ${emails.length} templates to docs/EMAIL_DRAFTS.md`);
