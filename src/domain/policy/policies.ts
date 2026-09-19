/**
 * Trading and account policies.
 *
 * Every policy here is a DRAFT awaiting the owner's approval. None of them was
 * in the build brief; the brief listed them as decisions with no default, and
 * the application shipped with no restriction in place and no permission
 * granted. These are proposals to replace that silence.
 *
 * They are modelled as data rather than prose so that:
 *
 *   - each one carries its own approval status, and an unapproved policy is
 *     never presented to a customer as a rule they agreed to;
 *   - the public rules page, the trader agreement and the admin console all
 *     render the same words, and cannot drift apart;
 *   - `needsLegalReview` marks the ones where a commercial decision is not
 *     sufficient, because the answer is determined by law rather than by
 *     preference.
 *
 * Nothing here is legal advice, and the drafting is deliberately plain: a rule
 * a trader cannot understand before they trade is a rule that produces a
 * dispute afterwards.
 */

import { type Governed, proposed } from '@/domain/config/requirement-status';

export type PolicyStance =
  /** Allowed, with no restriction beyond the published risk rules. */
  | 'PERMITTED'
  /** Not allowed. Breach is grounds for suspension or closure. */
  | 'PROHIBITED'
  /** Allowed within stated limits. */
  | 'CONDITIONAL'
  /** A process rather than a yes/no — how something is decided. */
  | 'FRAMEWORK';

export interface PolicyDraft {
  readonly key: string;
  readonly title: string;
  readonly stance: PolicyStance;
  /** One sentence. This is what appears on a purchase page. */
  readonly summary: string;
  /** The provisions themselves, as they would be published. */
  readonly rules: readonly string[];
  /** Why this is the recommendation. For the owner, not the customer. */
  readonly rationale: string;
  /**
   * True where counsel, not commercial preference, has to settle it. Approving
   * the commercial shape of these still leaves a legal question open.
   */
  readonly needsLegalReview: boolean;
}

const DRAFT_SOURCE = 'Drafted for owner approval — no default existed';

export const POLICY_DRAFTS: readonly Governed<PolicyDraft>[] = [
  proposed(
    {
      key: 'AUTOMATION',
      title: 'Automated trading systems',
      stance: 'CONDITIONAL',
      summary: 'Tools that help you trade are fine. Systems that trade without you are not.',
      rules: [
        'Execution aids are permitted: hotkeys, one-click order entry, bracket orders, ' +
          'trailing stops, position-sizing calculators and platform-native automation of an ' +
          'order you have placed.',
        'Fully autonomous systems that enter and exit positions with no human decision are not ' +
          'permitted without written approval from us in advance.',
        'Approval, where given, is specific to one system on one account and can be withdrawn.',
        'Any system whose edge depends on the simulated fill model rather than on the market — ' +
          'latency arbitrage, quote stuffing, exploiting stale or mispriced data — is prohibited ' +
          'outright and is not approvable.',
      ],
      rationale:
        'A blanket ban is unenforceable and drives away competent discretionary traders who use ' +
        'ordinary platform tooling. The real exposure is not automation; it is a system built to ' +
        'harvest the difference between a simulated fill and a real one, which is prohibited ' +
        'separately and on its own terms.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'NEWS_TRADING',
      title: 'News trading',
      stance: 'PERMITTED',
      summary: 'Trade the news. No blackout windows.',
      rules: [
        'There are no restricted windows around economic releases. You may hold through, enter ' +
          'into, and exit during any scheduled or unscheduled news event.',
        'Your risk limits do not change around news. The daily loss limit and the trailing ' +
          'drawdown apply exactly as they do at any other time.',
        'Fills during fast markets can differ sharply from the price on your screen, and that ' +
          'difference is yours. A gap through your stop that breaches a limit is still a breach.',
      ],
      rationale:
        'Most competitors restrict news trading, which is one of the loudest complaints about ' +
        'them. Permitting it is consistent with "no consistency rules, no evaluation" and costs ' +
        'nothing that the drawdown rules do not already control. The third provision matters: ' +
        'it sets the expectation before the dispute rather than after it.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'HEDGING',
      title: 'Cross-account hedging',
      stance: 'PROHIBITED',
      summary: 'No holding opposite sides of the same market across accounts.',
      rules: [
        'You may not hold offsetting positions in the same or economically equivalent ' +
          'instruments across two or more accounts, whether those accounts are yours, held with ' +
          'us, or held elsewhere.',
        'You may not coordinate with another person so that between you the same offset exists.',
        'Hedging within a single account — a spread, a calendar, an options overlay — is not ' +
          'affected by this and is permitted.',
        'Where we find an offset of this kind, the affected payouts are withheld pending review ' +
          'and the accounts may be closed.',
      ],
      rationale:
        'This is the single structural attack on the model. Two accounts on opposite sides means ' +
        'one of them shows a large profit whatever the market does, and that profit is paid in ' +
        'real cash against simulated performance. Every serious firm prohibits it, and it needs ' +
        'to be explicit rather than inferred from general misconduct language.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'COPY_TRADING',
      title: 'Copy trading and signal services',
      stance: 'CONDITIONAL',
      summary: 'Follow whoever you like. Do not run a group of accounts as one position.',
      rules: [
        'You may follow a signal service, a mentor, a room or a strategy provider, and you may ' +
          'copy their trades to your account.',
        'You may not mirror trades into accounts held by other people, and you may not have your ' +
          'trades mirrored into accounts you do not own.',
        'Where several accounts trade the same instruments in the same direction with closely ' +
          'matched timing and sizing, we may treat them as a single coordinated position for ' +
          'risk purposes.',
        'Nothing here limits what you do on your own capital elsewhere.',
      ],
      rationale:
        'Banning copy trading outright is both unpopular and unenforceable — following a room is ' +
        'normal retail behaviour. The exposure is a group of accounts operated as one book, which ' +
        'is cross-account hedging wearing a different hat, so the third provision addresses the ' +
        'aggregate rather than the act of copying.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'ELIGIBILITY',
      title: 'Who can open an account',
      stance: 'FRAMEWORK',
      summary: 'Adults, outside sanctioned jurisdictions, one account each, identity verified.',
      rules: [
        'You must be at least 18, and old enough to enter a binding contract where you live.',
        'We cannot offer accounts to residents of sanctioned jurisdictions, or of any country ' +
          'where offering this product would require a licence we do not hold. The current list ' +
          'is published at checkout and can change.',
        'One active account per verified person during the pilot.',
        'Identity verification is required before a payout, not before a purchase. If you cannot ' +
          'complete it, we refund the purchase in full rather than keeping the money for an ' +
          'account that can never pay out.',
      ],
      rationale:
        'The country list itself is a legal determination, not a commercial one, and I have not ' +
        'invented one. The last provision is the part worth arguing about: verifying at payout ' +
        'rather than at purchase reduces checkout friction sharply, and the refund commitment is ' +
        'what stops that becoming a way to sell accounts to people who can never be paid.',
      needsLegalReview: true,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'REFUNDS',
      title: 'Refunds and cancellation',
      stance: 'FRAMEWORK',
      summary: 'Full refund until you use the account. After that it has been delivered.',
      rules: [
        'Full refund on request at any time before your platform credentials are issued.',
        'Full refund within 7 days of purchase if you have placed no trades on the account.',
        'Once a trade has been placed, the account has been delivered and is not refundable.',
        'Reset fees are not refundable, because a reset takes effect immediately on payment.',
        'If we close your account for a reason that is not your breach — we withdraw the ' +
          'product, we cannot verify you, we cannot deliver platform access — you are refunded ' +
          'in full regardless of trading activity.',
        'Statutory cancellation rights where you live are not affected by any of this.',
      ],
      rationale:
        'A digital product delivered on payment, so the trigger is use rather than time. The ' +
        '7-day no-trades window covers genuine change of mind without covering a losing week. ' +
        'The final two provisions are the ones that keep this defensible: a refund when the ' +
        'failure is ours, and no attempt to contract out of consumer law.',
      needsLegalReview: true,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'INACTIVITY',
      title: 'Inactive accounts',
      stance: 'CONDITIONAL',
      summary: 'No trades for 90 days and the account closes. We warn you twice first.',
      rules: [
        'An account with no trading activity for 90 consecutive days is closed.',
        'We email you at 60 days and again at 83 days, to the address on the account.',
        'A single trade resets the clock.',
        'Closure for inactivity does not refund the purchase, and does not forfeit a payout you ' +
          'have already requested and become eligible for.',
      ],
      rationale:
        'Some limit is necessary: a dormant account is an open-ended obligation carried against ' +
        'a one-time payment. 90 days is deliberately generous — 30 would catch traders taking a ' +
        'normal break and generate complaints worth more than the liability it saves.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'RESETS',
      title: 'Resets',
      stance: 'CONDITIONAL',
      summary: 'Breached an account? Reset it for less than a new one costs.',
      rules: [
        'A reset is available once an account can no longer trade — after a max drawdown breach, ' +
          'or on an account you have closed yourself.',
        'A reset restores the starting balance, the high-water mark and the trailing threshold.',
        'A reset does not restore lifetime payout capacity. What you have already been paid still ' +
          'counts against the cap.',
        'There is no limit on how many times an account may be reset.',
        'A reset is not available while a payout request is in progress, or while positions are ' +
          'open.',
        'An account that has reached its lifetime payout cap cannot be usefully reset, and we ' +
          'will not sell you one. Buy a new account instead.',
      ],
      rationale:
        'Price and mechanics were already confirmed; this is the availability and the limits ' +
        'around them. The third and last provisions are load-bearing — if a reset restored payout ' +
        'capacity, the cheapest product in the catalogue would clear the lifetime cap and ' +
        'per-customer exposure would be unbounded at reset prices.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'CONDUCT',
      title: 'Prohibited conduct, evidence and appeals',
      stance: 'FRAMEWORK',
      summary: 'What gets an account closed, what we have to show, and how you challenge it.',
      rules: [
        'Prohibited: trading another person’s account or letting another person trade yours; ' +
          'misrepresenting your identity or residence; opening more accounts than you are ' +
          'permitted; exploiting a platform error, a stale or mispriced feed, or a latency gap; ' +
          'cross-account hedging; charging back a payment instead of requesting a refund.',
        'Before we withhold a payout or close an account for conduct, we document the specific ' +
          'finding and the data it rests on.',
        'We tell you what we found, with the trades, times and account identifiers it is based ' +
          'on. "Violation of our terms" on its own is not a reason we will give you.',
        'You have 30 days to appeal in writing. The appeal is reviewed by someone who was not ' +
          'part of the original decision, and we respond within 10 business days.',
        'While an appeal is open we do not close the account permanently or reverse a payout that ' +
          'has already been paid.',
        'If the appeal succeeds we restore the account and pay what was withheld.',
      ],
      rationale:
        'This is the policy the industry is most criticised for, and the one most likely to end ' +
        'up in front of a regulator or a payment processor. The evidence standard and the named ' +
        'appeal route cost very little when you intend to behave well, and they are close to ' +
        'worthless written vaguely. The third provision is the one that matters commercially: ' +
        'refusing to give reasons is what generates the public complaints that sink firms.',
      needsLegalReview: true,
    },
    undefined,
    DRAFT_SOURCE,
  ),

  proposed(
    {
      key: 'CLOSURE',
      title: 'How an account ends',
      stance: 'FRAMEWORK',
      summary: 'Cap reached, drawdown breached, closed by you, or closed by us.',
      rules: [
        'Lifetime cap reached: the account is complete. It stops trading, and a new account is ' +
          'the way to continue.',
        'Max drawdown breached: trading on that account ends. A reset is the way back.',
        'Closed by you: at any time, in the dashboard. Any payout you were already eligible for ' +
          'is still paid.',
        'Closed by us for conduct: subject to the evidence and appeal process above.',
        'Withdrawn product: if we stop offering a plan, existing accounts continue under the ' +
          'terms they were sold on. We do not retire an account you paid for.',
        'On closure you keep read access to your trading history and payout records for 12 ' +
          'months.',
      ],
      rationale:
        'Mostly a restatement of decisions already made, gathered in one place because a trader ' +
        'asking "what happens to my account" should not have to assemble the answer from five ' +
        'pages. The last two are new: not retiring a paid account under a withdrawn plan, and ' +
        'keeping records readable afterwards.',
      needsLegalReview: false,
    },
    undefined,
    DRAFT_SOURCE,
  ),
];

export function getPolicyDraft(key: string): Governed<PolicyDraft> {
  const found = POLICY_DRAFTS.find((p) => p.value.key === key);
  if (!found) throw new Error(`Unknown policy ${key}`);
  return found;
}

/** Policies whose commercial shape is settled but whose wording needs counsel. */
export function policiesNeedingLegalReview(): readonly Governed<PolicyDraft>[] {
  return POLICY_DRAFTS.filter((p) => p.value.needsLegalReview);
}

/** True while any policy is still a draft, which blocks production sale. */
export function policiesBlockProductionSale(): boolean {
  return POLICY_DRAFTS.some((p) => p.status !== 'CONFIRMED');
}
