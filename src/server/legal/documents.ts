/**
 * Checkout agreement drafts.
 *
 * These are ATTORNEY-REVIEW DRAFTS, not legal advice and not enforceable
 * documents. They are seeded with status DRAFT_PENDING_LEGAL_REVIEW and the
 * production launch gate refuses to open while any required document is still
 * in that status.
 *
 * Terms that were not supplied are marked [NOT SUPPLIED] rather than guessed.
 * Governing law, arbitration, class-action waiver, refundability, tax treatment
 * and geographic eligibility are all material commercial choices with real
 * consequences; silently picking one on the owner's behalf would be inventing
 * the most consequential terms in the contract.
 */

import { createHash } from 'node:crypto';

export interface LegalDocumentDraft {
  readonly slug: string;
  readonly version: number;
  readonly title: string;
  readonly body: string;
  readonly requiredAtCheckout: boolean;
}

const NOT_SUPPLIED = '[NOT SUPPLIED — owner and counsel must complete before launch]';
const COMPANY = '[COMPANY LEGAL NAME]';

const HEADER = `
DRAFT — PENDING LEGAL REVIEW
This document has not been reviewed or approved by a lawyer. It is a working
draft prepared to make the product flow testable. It is not legal advice and
must not be presented to customers in this form.
`.trim();

export const LEGAL_DOCUMENT_DRAFTS: readonly LegalDocumentDraft[] = [
  {
    slug: 'trader-agreement',
    version: 1,
    title: 'Trader Agreement',
    requiredAtCheckout: true,
    body: `${HEADER}

1. WHAT YOU ARE BUYING

You are purchasing one-time access to a SIMULATED futures trading account
provided by ${COMPANY} ("we", "us"). You are not opening a brokerage account,
you are not depositing funds with us, and you are not trading in live markets
through this program.

The balance shown in your simulated account is a NOTIONAL FIGURE used to
measure performance under the rules of this program. It is not money, it is not
held for you, and you have no claim to it as cash.

2. NO EVALUATION PHASE

This program has no evaluation phase and no profit target you must reach before
becoming eligible for rewards. There is no consistency rule and no best-day
concentration test. There is no minimum number of trading days and no minimum
number of winning days.

3. YOUR PLAN AND ITS RULES

The specific account size, price, position limits, daily loss limit, trailing
drawdown allowance, retained profit buffer and payout caps that apply to you are
set out in the Plan and Rules Snapshot presented to you at checkout and attached
to your order. Those figures form part of this agreement.

We may change the rules for FUTURE purchases at any time. Changing them does not
alter the rules attached to an account you have already bought.

4. REWARDS

Eligible rewards are divided 50% to you and 50% to us for the purpose of
calculating deductions from your simulated account. A gross withdrawal of $500
reduces your simulated account by $500 and pays you $250 in real cash. The
remaining $250 is not paid to anyone; it is simulated balance that ceases to
exist.

The minimum gross withdrawal is $500, paying $250 in cash.

5. NO GUARANTEE

We do not guarantee that you will earn anything. We do not guarantee that any
particular payout will be approved, or the time any payment will take to reach
your bank. Most participants in programs of this kind do not receive a payout.

6. FEES AND BILLING

The purchase price is a ONE-TIME charge. This is not a subscription and it does
not automatically renew.

7. TERMS NOT YET SETTLED

The following terms are not settled and must be completed before this agreement
is used with real customers:

- Governing law and jurisdiction: ${NOT_SUPPLIED}
- Dispute resolution, arbitration and any class-action waiver: ${NOT_SUPPLIED}
- Refund and cancellation policy: ${NOT_SUPPLIED}
- Geographic eligibility and restricted countries: ${NOT_SUPPLIED}
- Tax treatment and any reporting or withholding obligations: ${NOT_SUPPLIED}
- Limitation of liability and indemnities: ${NOT_SUPPLIED}
- Account inactivity and program termination: ${NOT_SUPPLIED}
`,
  },

  {
    slug: 'simulation-and-reward-disclosure',
    version: 1,
    title: 'Simulation and Reward Disclosure',
    requiredAtCheckout: true,
    body: `${HEADER}

SIMULATED TRADING

All trading in this program is simulated. Orders you place do not reach a live
exchange and do not affect real market prices. Simulated results do not
represent live trading and cannot account for every real-world factor,
including liquidity, slippage in fast markets, order queue position, or
execution during news events.

YOUR SIMULATED BALANCE IS NOT CASH

The account size you purchase — for example "$50,000" — is a nominal figure. We
do not hold $50,000 for you. You cannot withdraw your simulated balance. What
you can earn is a CASH REWARD calculated against simulated profits under the
rules of your plan.

HOW A REWARD IS CALCULATED

Your account has a retained profit buffer that must remain in the simulated
account. Only profit above your starting balance AND above that buffer can form
the basis of a reward.

Worked example on the proposed $50,000 rules:

  Starting balance      $50,000
  Retained buffer        $2,000
  Simulated balance     $52,500

  Available gross          $500   (52,500 - 50,000 - 2,000)
  Cash paid to you         $250   (50% of gross)
  Simulated balance left $52,000

At a simulated balance of $52,499 the available gross would be $499, which is
below the $500 minimum, so no withdrawal would be available yet.

THE BUFFER IS NOT A PROFIT TARGET

The retained buffer is not an evaluation you must pass. It is an amount that
stays in the simulated account. It affects WHEN a withdrawal becomes available
and how much is available, and nothing else.

RISKS

- You may lose the fee you paid and receive nothing.
- Your account can breach its daily loss limit or its trailing drawdown
  threshold, which pauses or ends your access under the rules of your plan.
- Commissions and trading fees reduce your net results.
- Payout eligibility does not guarantee payment on any particular day. Payment
  timing depends on the payment rails, your identity verification status and
  banking cut-off times.

FIRST-DAY ELIGIBILITY

Same-day payout eligibility, including on your first trading day, is available
if every other published requirement is met. This is a statement about
ELIGIBILITY rules, not a guarantee that funds will arrive in your bank account
the same day.
`,
  },

  {
    slug: 'purchase-and-refund-terms',
    version: 1,
    title: 'Purchase, Coupon and Refund Terms',
    requiredAtCheckout: true,
    body: `${HEADER}

ONE-TIME PURCHASE

Your purchase is a single charge. It is not a subscription, there is no
recurring billing, and nothing renews automatically.

PRICING

The price charged is the price shown in your order summary at the moment you
confirm. All prices are calculated on our servers from our published catalog.

COUPONS

A discount code applies the stated percentage to eligible account and add-on
line items before any applicable tax. Only one code may be applied to an order;
codes do not stack. A code may have a validity window, a total usage limit and a
per-customer usage limit.

TAX

Tax treatment: ${NOT_SUPPLIED}. Amounts displayed exclude any tax that may
apply. This must be resolved before any sale to a real customer.

OPTIONAL ADD-ONS

Add-ons are optional. No add-on is required for normal account access, to see
the rules that apply to you, to request a payout, to receive a payout you have
earned, to see your basic account statistics, to export your basic records, to
secure your account, or to receive ordinary support.

Add-ons requiring a scheduled session are sold only while real capacity exists.

REFUNDS AND CANCELLATION

Refund and cancellation policy: ${NOT_SUPPLIED}.

This section must state whether the fee is refundable, within what period, in
what circumstances, and how a refund interacts with an account that has already
been provisioned or has already received a reward.

IF WE CANNOT PROVISION YOUR ACCOUNT

If your payment succeeds but we cannot create your simulated account, we will
tell you truthfully that the account does not exist, retry a bounded number of
times, and escalate to our team. You are entitled to support and to a remedy
under the refund policy above once that policy is settled.
`,
  },

  {
    slug: 'payout-policy',
    version: 1,
    title: 'Payout Policy and Program Limits',
    requiredAtCheckout: true,
    body: `${HEADER}

WHEN A PAYOUT IS AVAILABLE

A payout request is available when all of the following are true:

- Your simulated balance exceeds your starting balance plus your retained
  buffer by at least the $500 minimum gross withdrawal.
- Your positions are flat and you have no working orders.
- Your account is active and not breached.
- We have current authoritative data for your account.
- The withdrawal would not take your equity to or below your trailing
  drawdown threshold.

There is no minimum number of trading days, no minimum number of winning days,
no consistency requirement and no best-day test.

HOW MUCH

  Maximum gross = the smallest of:
    (a) simulated balance - starting balance - retained buffer
    (b) twice your remaining DAILY cash payout capacity
    (c) twice your remaining LIFETIME cash payout capacity, if a lifetime cap
        applies to your plan
    (d) the room that must remain above your trailing threshold

rounded down to a whole dollar. You are paid half the gross in cash.

DAILY AND LIFETIME CAPS

Your plan has a daily cash payout cap. Capacity is reserved when you make a
request, not when it is paid, so several requests share the same daily cap and a
pending request continues to count against the day it was made.

Lifetime cash payout cap for your plan: as stated in your Plan and Rules
Snapshot. Where the snapshot shows this as not yet decided, accounts on that
plan are not offered for sale.

PROCESSING

Eligibility, processing and settlement are three different things and are shown
separately in your dashboard. Eligibility is determined by the rules above.
Processing depends on our review where a request needs one. Settlement depends
on the payment rails, your verification status and banking cut-off times.

We do not guarantee same-day receipt of funds in your bank account.

REVIEW

Requests that meet every requirement may be approved automatically. A request
that needs review will show you the specific reason. We will not use routine
review as a way to impose an undisclosed waiting period.

A payout you have validly earned is not cancelled by a later unrelated change to
your account status. Any review of an earned payout is recorded with its reason.

PROGRAM COMPLETION

Program completion and account closure rules: ${NOT_SUPPLIED}.
`,
  },

  {
    slug: 'prohibited-conduct',
    version: 1,
    title: 'Prohibited Conduct, Breach and Appeal',
    requiredAtCheckout: true,
    body: `${HEADER}

BREACH OF TRADING RULES

Two limits end or pause your trading:

- DAILY LOSS LIMIT. Reaching your plan's daily loss limit causes your positions
  to be flattened and trading to be paused until the next trading session.
- TRAILING DRAWDOWN THRESHOLD. Your threshold follows your highest observed
  intraday equity, including unrealized gains, and never moves back down.
  Equity touching or falling below it ends trading access on that account.

Your daily loss is measured on trading results only. A withdrawal reduces your
equity but is not counted as a trading loss.

We will show you the reason for any breach and the account data that supports
it.

PROHIBITED CONDUCT

The specific list of prohibited conduct is ${NOT_SUPPLIED} and must be settled
before launch. Policies are required for at least the following, each of which
is configurable in our systems and none of which we have invented on the owner's
behalf:

- Automated trading systems and bots
- Trading around scheduled news events
- Hedging positions across multiple accounts
- Copy trading and trade mirroring
- Group or coordinated trading
- Exploiting simulated fills that would not occur in a live market
- Account sharing and access by anyone other than the verified account holder

SUSPENSION AND APPEAL

Suspension process, evidence standards, notice periods and the appeal route are
${NOT_SUPPLIED}.

Until those are settled, any suspension decision in this system records the
specific reason and the supporting events, and both are visible to the account
holder.
`,
  },

  {
    slug: 'privacy-and-data',
    version: 1,
    title: 'Privacy and Data Processing',
    requiredAtCheckout: true,
    body: `${HEADER}

WHAT WE COLLECT

- Account details: your email address and the legal name you provide.
- Identity verification data, where an identity check is configured.
- Order, payment and payout records.
- Trading activity on your simulated account, including equity, positions,
  orders and fills.
- Signature evidence: the document and terms you signed, the time, and limited
  technical evidence such as IP address and browser user agent.
- Support correspondence.

WHAT WE DO NOT COLLECT

We never receive or store your full card number. Card details are entered
directly with our payment provider on their hosted page.

WHO WE SHARE IT WITH

- Our payment provider, to take payment and issue refunds.
- Our trading platform provider, to create and operate your simulated account.
- Our identity verification provider, where configured.
- Professional advisers and authorities where we are legally required to.

Specific named processors: ${NOT_SUPPLIED}.

RETENTION

Signature and consent evidence is retained for the period required to evidence
the agreement. Specific retention periods: ${NOT_SUPPLIED}.

Access to identity documents and signature evidence is restricted to staff who
need it for a specific task, and that access is logged.

YOUR RIGHTS

Your rights over your data depend on where you live, which depends on the
geographic eligibility policy that is ${NOT_SUPPLIED}. Contact
[COMPANY SUPPORT EMAIL] for any data request.
`,
  },

  {
    slug: 'electronic-signature-consent',
    version: 1,
    title: 'Consent to Electronic Records and Signatures',
    requiredAtCheckout: true,
    body: `${HEADER}

By typing your full legal name and submitting the checkout form, you are signing
these documents electronically and agreeing that:

- You consent to receive these records electronically rather than on paper.
- Your typed legal name is intended as your signature.
- You have been able to read the full text of each document before signing.
- You can download and keep a copy of everything you signed, at any time, from
  your dashboard.

WHAT WE RECORD AS EVIDENCE

- Your authenticated user account.
- The exact text of each document you signed, and its cryptographic hash.
- The exact plan, rules and price you agreed to, and its cryptographic hash.
- The consent wording displayed next to the signature field.
- The date and time of signing.
- Limited technical evidence: IP address and browser user agent.

A NOTE ON ENFORCEABILITY

Ticking a box and typing a name creates a record of agreement. It does not by
itself guarantee that every term in these documents is enforceable against you
or against us. Enforceability depends on the law that applies, which is
${NOT_SUPPLIED}, and on the terms themselves, which have not yet been reviewed
by a lawyer.

WITHDRAWING CONSENT

You may withdraw consent to electronic records by contacting
[COMPANY SUPPORT EMAIL]. Withdrawing consent does not undo an agreement you have
already signed.
`,
  },
];

export function hashDocumentBody(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
