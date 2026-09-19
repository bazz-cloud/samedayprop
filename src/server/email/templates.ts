/**
 * Every customer email, in one place.
 *
 * Typed templates rather than strings scattered through the services that send
 * them, for three reasons:
 *
 *   1. A rule quoted in an email must match the rule the engine enforces. Every
 *      figure here arrives as an argument computed from the same plan and
 *      account data the site renders, so an email cannot drift from the rules.
 *   2. They are testable. The assertions in tests/emails.test.ts check the
 *      things that would be expensive to get wrong — that a breach email names
 *      which limit, that a payout email never promises an arrival time, and
 *      that no template embeds a password.
 *   3. They can be reviewed before a provider exists. Nothing here sends; each
 *      returns an OutgoingEmail for the configured provider to handle, which in
 *      this environment is the local outbox.
 *
 * WRITING RULES, applied throughout:
 *   - Plain text is the source. HTML is optional decoration, never the only
 *     copy, because a plain-text-only client must still get the whole message.
 *   - No earnings claims, no guarantees, no "funded trader" language. These are
 *     simulated accounts and the copy says so wherever money is mentioned.
 *   - A password is NEVER in an email. Credentials mail carries a link and a
 *     one-time acknowledgement, never the secret itself.
 *   - Amounts are stated with their currency and never rounded for prose.
 */

import type { OutgoingEmail } from '@/server/providers/email/outbox';

export interface Company {
  readonly name: string;
  readonly supportEmail: string;
  readonly baseUrl: string;
}

/** Appended to every message. The unsubscribe line is deliberately absent:
 *  these are transactional, and offering to unsubscribe from a payout
 *  confirmation would be worse than useless. */
function footer(company: Company): string {
  return [
    '',
    '—',
    `${company.name}`,
    `Questions: ${company.supportEmail}`,
    '',
    'All trading in this program is simulated. Account sizes are nominal figures,',
    'not cash held for you. You can lose the fee you pay and receive nothing.',
    'This is a service message about your account, not marketing.',
  ].join('\n');
}

function compose(
  company: Company,
  to: string,
  subject: string,
  lines: readonly string[],
  attachments?: OutgoingEmail['attachments'],
): OutgoingEmail {
  return {
    to,
    subject,
    bodyText: [...lines, footer(company)].join('\n'),
    ...(attachments ? { attachments } : {}),
  };
}

// ---------------------------------------------------------------------------
// 1 · Account purchased
// ---------------------------------------------------------------------------

export function accountPurchased(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  amountPaid: string;
  orderReference: string;
}): OutgoingEmail {
  return compose(
    input.company,
    input.to,
    `Your ${input.planLabel} simulated account — order ${input.orderReference}`,
    [
      `${input.name},`,
      '',
      `Your ${input.planLabel} simulated account is paid for and is being set up.`,
      '',
      `Paid: ${input.amountPaid}`,
      `Order: ${input.orderReference}`,
      '',
      'This was a one-time charge. Nothing renews, and no card is kept on file.',
      '',
      'Your signed agreements are attached as a single PDF. Each document inside',
      'it is identified by version and by a SHA-256 hash of its exact text, so',
      'what you agreed to can be verified later.',
      '',
      'Your platform sign-in arrives in a separate message once the account is',
      'created and its limits have been applied and read back. We do not enable',
      'trading until those limits are confirmed.',
      '',
      `Track it here: ${input.company.baseUrl}/dashboard`,
    ],
    [{ filename: 'agreements.pdf', description: 'Every document you signed, with hashes' }],
  );
}

// ---------------------------------------------------------------------------
// 2 · Credentials issued
// ---------------------------------------------------------------------------

export function credentialsIssued(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  username: string;
}): OutgoingEmail {
  return compose(input.company, input.to, 'Your platform sign-in is ready', [
    `${input.name},`,
    '',
    `Your ${input.planLabel} account is live and your platform sign-in is ready.`,
    '',
    `Username: ${input.username}`,
    '',
    // The password is not here, and this explains why rather than looking like
    // an omission — otherwise the first reply is "you forgot the password".
    'Your password is NOT in this email. We show it once, in your dashboard, and',
    'keep only a hash of it afterwards — so we cannot email it to you, and',
    'neither can anyone who reads your mail.',
    '',
    `Collect it here: ${input.company.baseUrl}/dashboard`,
    '',
    'If you lose it we issue a new one. We cannot recover the old one.',
    '',
    'Nobody from this company will ever ask you for your password.',
  ]);
}

// ---------------------------------------------------------------------------
// 3 · Daily loss lockout
// ---------------------------------------------------------------------------

export function dailyLossLockout(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  dailyLossLimit: string;
  sessionLoss: string;
  reopensAt: string;
}): OutgoingEmail {
  return compose(input.company, input.to, 'Trading paused until the next session', [
    `${input.name},`,
    '',
    `Your ${input.planLabel} account reached its daily loss limit, so open`,
    'positions were flattened and trading is paused.',
    '',
    `Daily loss limit: ${input.dailyLossLimit}`,
    `Session result:   ${input.sessionLoss}`,
    `Trading reopens:  ${input.reopensAt}`,
    '',
    'This is a pause, not a breach. The account is intact, your balance is',
    'unchanged by this, and no reset is needed — it lifts by itself.',
    '',
    'Withdrawals are not counted as trading losses. If you withdrew today, that',
    'did not contribute to this limit.',
    '',
    `${input.company.baseUrl}/dashboard`,
  ]);
}

// ---------------------------------------------------------------------------
// 4 · Account breached
// ---------------------------------------------------------------------------

export function accountBreached(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  breachType: 'TRAILING' | 'DAILY_LOSS';
  equityAtBreach: string;
  thresholdAtBreach: string;
  occurredAt: string;
  resetPrice: string;
}): OutgoingEmail {
  const which =
    input.breachType === 'TRAILING'
      ? 'the trailing drawdown threshold'
      : 'the maximum drawdown limit';

  return compose(input.company, input.to, `Your ${input.planLabel} account has ended`, [
    `${input.name},`,
    '',
    `Trading on your ${input.planLabel} account has ended. It reached ${which}.`,
    '',
    `Equity at that point: ${input.equityAtBreach}`,
    `Threshold:            ${input.thresholdAtBreach}`,
    `When:                 ${input.occurredAt}`,
    '',
    // Naming the exact figures is the difference between a notice and a
    // dispute. The full evidence is one click away rather than on request.
    'Equity touching the threshold is a breach, not only falling below it.',
    '',
    `The full record — every equity observation, the threshold at each one, and`,
    'the event that ended the account — is on your dashboard. If you think this',
    'is wrong, reply to this email and we will look at that record with you.',
    '',
    `Starting again costs ${input.resetPrice} as a reset, which is less than a new`,
    'account. A reset restores the balance, the high-water mark and the',
    'threshold. It does NOT restore payout capacity you have already used.',
    '',
    'The fee you paid is not refunded.',
    '',
    `${input.company.baseUrl}/dashboard`,
  ]);
}

// ---------------------------------------------------------------------------
// 5 · Payout requested
// ---------------------------------------------------------------------------

export function payoutRequested(input: {
  company: Company;
  to: string;
  name: string;
  grossAmount: string;
  cashAmount: string;
  requestReference: string;
}): OutgoingEmail {
  return compose(input.company, input.to, `Payout request received — ${input.cashAmount}`, [
    `${input.name},`,
    '',
    'We have your payout request.',
    '',
    `Gross withdrawal: ${input.grossAmount}`,
    `Cash to you:      ${input.cashAmount}`,
    `Reference:        ${input.requestReference}`,
    '',
    `Your simulated balance has been reduced by ${input.grossAmount}. The other half`,
    'is not paid to anyone — it is simulated balance that ceases to exist.',
    '',
    // The single most important sentence in the whole set. Eligibility is a
    // rule we control; settlement is not, and conflating them is what generates
    // angry tickets on day one.
    'Eligibility, processing and settlement are three different things. We',
    'cannot promise when the money lands: that depends on the payment rails,',
    'your verification status and banking cut-off times.',
    '',
    `You can see which stage this request is at here: ${input.company.baseUrl}/dashboard`,
  ]);
}

// ---------------------------------------------------------------------------
// 6 · Payout paid
// ---------------------------------------------------------------------------

export function payoutPaid(input: {
  company: Company;
  to: string;
  name: string;
  cashAmount: string;
  requestReference: string;
  sentAt: string;
  remainingLifetimeCap: string | null;
}): OutgoingEmail {
  return compose(input.company, input.to, `Payout sent — ${input.cashAmount}`, [
    `${input.name},`,
    '',
    `${input.cashAmount} has been sent.`,
    '',
    `Reference: ${input.requestReference}`,
    `Sent:      ${input.sentAt}`,
    ...(input.remainingLifetimeCap
      ? ['', `Remaining lifetime payout capacity: ${input.remainingLifetimeCap}`]
      : []),
    '',
    // "Sent" and "arrived" are different events. Saying so here prevents the
    // support ticket two days later.
    'Sent is not the same as arrived. When it reaches your account depends on',
    'your bank and the payment rail, not on us.',
    '',
    `${input.company.baseUrl}/dashboard`,
  ]);
}

// ---------------------------------------------------------------------------
// 7 · Inactivity warning
// ---------------------------------------------------------------------------

export function inactivityWarning(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  daysInactive: number;
  closesOn: string;
}): OutgoingEmail {
  return compose(
    input.company,
    input.to,
    `Your ${input.planLabel} account closes on ${input.closesOn}`,
    [
      `${input.name},`,
      '',
      `Your ${input.planLabel} account has had no trading activity for`,
      `${input.daysInactive} days. Accounts close after 90 days without a trade.`,
      '',
      `This one closes on ${input.closesOn} unless you place a trade before then.`,
      'A single trade resets the clock.',
      '',
      'Closing for inactivity does not refund the fee. It does not forfeit a',
      'payout you have already requested and become eligible for.',
      '',
      `${input.company.baseUrl}/dashboard`,
    ],
  );
}

// ---------------------------------------------------------------------------
// 8 · Reset purchased
// ---------------------------------------------------------------------------

export function resetPurchased(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  amountPaid: string;
  restoredBalance: string;
  remainingLifetimeCap: string | null;
}): OutgoingEmail {
  return compose(input.company, input.to, `Your ${input.planLabel} account is reset`, [
    `${input.name},`,
    '',
    `Your ${input.planLabel} account has been reset and can trade again.`,
    '',
    `Paid:              ${input.amountPaid}`,
    `Balance restored:  ${input.restoredBalance}`,
    ...(input.remainingLifetimeCap
      ? [`Payout capacity:   ${input.remainingLifetimeCap} remaining`]
      : []),
    '',
    'Your high-water mark and trailing threshold were restored with the balance.',
    '',
    // Stated plainly because it is the part people misremember, and the part
    // that matters when they reach the cap later.
    'Payout capacity you had already used was NOT restored. A reset returns the',
    'account to its starting state; it does not return the money you were paid.',
    '',
    'You keep the same platform sign-in.',
    '',
    `${input.company.baseUrl}/dashboard`,
  ]);
}

// ---------------------------------------------------------------------------
// 9 · Lifetime cap reached
// ---------------------------------------------------------------------------

export function lifetimeCapReached(input: {
  company: Company;
  to: string;
  name: string;
  planLabel: string;
  lifetimeCap: string;
  totalPaid: string;
  newAccountPrice: string;
}): OutgoingEmail {
  return compose(
    input.company,
    input.to,
    `Your ${input.planLabel} account is complete — ${input.totalPaid} paid`,
    [
      `${input.name},`,
      '',
      // Deliberately congratulatory. This is the opposite of a breach: the
      // trader earned everything the account could ever pay. Wording it like a
      // termination turns a success into a grievance.
      `You have been paid the full lifetime limit on your ${input.planLabel} account.`,
      '',
      `Lifetime limit: ${input.lifetimeCap}`,
      `Paid to you:    ${input.totalPaid}`,
      '',
      'That account is now complete and closed for trading. Nothing went wrong and',
      'nothing was forfeited — you reached the ceiling the account was sold with.',
      '',
      'We closed it rather than leaving it open because it has no payout capacity',
      'left. Trading on for a withdrawal that cannot be approved would waste your',
      'time.',
      '',
      `To keep trading, buy a new account. A new ${input.planLabel} account is`,
      `${input.newAccountPrice} and starts with its full lifetime limit again.`,
      '',
      // Said plainly here because this is the moment people try it.
      'A reset will not reopen this one. A reset restores the balance, not the',
      'payout capacity you have already used, so it would return an account that',
      'can trade and can never pay out. We do not sell resets on completed',
      'accounts.',
      '',
      `${input.company.baseUrl}/accounts`,
    ],
  );
}

/** Every template, for the review document and for tests. */
export const TEMPLATE_NAMES = [
  'accountPurchased',
  'credentialsIssued',
  'dailyLossLockout',
  'accountBreached',
  'payoutRequested',
  'payoutPaid',
  'inactivityWarning',
  'resetPurchased',
  'lifetimeCapReached',
] as const;
