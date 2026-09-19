import type { Metadata } from 'next';
import Link from 'next/link';
import { Accordion } from '@/components/system';

export const metadata: Metadata = { title: 'Frequently asked questions' };

/**
 * FAQ.
 *
 * Every answer is under 40 words, asserted by tests/faq.test.ts rather than by
 * eye. Answers are plain strings so they can be counted; a link, where one is
 * needed, is data beside the answer rather than markup inside it.
 *
 * The 40-word ceiling is a diagnostic as much as a style rule. An answer that
 * will not fit usually means the underlying rule has no clear home of its own,
 * and the fix is a better page rather than a longer answer here.
 */
export interface FaqEntry {
  readonly q: string;
  readonly a: string;
  readonly link?: { readonly href: string; readonly label: string };
}

export const FAQS: readonly FaqEntry[] = [
  {
    q: 'Is this real money trading?',
    a: 'No. All trading in this program is simulated. Your orders do not reach a live exchange. The account size is a nominal figure, not cash held for you. What you earn is real cash against simulated profits.',
  },
  {
    q: 'If I have a $50,000 account, do you hold $50,000 for me?',
    a: 'No. Nothing is held for you, and the simulated balance cannot be withdrawn. A $500 gross withdrawal reduces it by $500 and pays you $250 in real cash. The other $250 ceases to exist.',
  },
  {
    q: 'Is there an evaluation or a profit target?',
    a: 'No. There is no evaluation phase and no profit target to pass before you trade.',
  },
  {
    q: 'Is there a consistency rule or a best-day test?',
    a: 'No. A single large winning day does not reduce or disqualify a payout.',
  },
  {
    q: 'How soon can I request a payout?',
    a: 'As soon as you meet the six published conditions, including on your first trading day. No minimum trading days, no minimum winning days.',
    link: { href: '/payouts#eligibility', label: 'The six conditions' },
  },
  {
    q: 'Will the cash reach my bank the same day?',
    a: 'We cannot promise that. Same-day eligibility is a rule about when you can request. Arrival depends on payment rails, your verification status and banking cut-off times.',
    link: { href: '/payouts#timing', label: 'Eligibility, processing and settlement' },
  },
  {
    q: 'What is the retained buffer? Is it a target I have to hit?',
    a: 'Neither a target nor an evaluation. It is profit that stays in the simulated account, and it affects only when a withdrawal becomes available and how much.',
    link: { href: '/payouts#caps', label: 'Buffer by account size' },
  },
  {
    q: 'Does a withdrawal count against my daily loss limit?',
    a: 'No. It lowers your equity but it is not a trading loss. It does reduce the room above your trailing threshold, because that threshold never moves down.',
  },
  {
    q: 'Does my trailing threshold go back down if I give back profit?',
    a: 'No. It follows your highest equity upward, including unrealized gains, and never moves back down. It stops rising at your starting balance plus $100.',
    link: { href: '/rules#drawdown', label: 'See the diagram' },
  },
  {
    q: 'Is this a subscription?',
    a: 'No. Each account is a one-time purchase. Nothing renews automatically.',
  },
  {
    q: 'Do I have to buy an add-on to get paid, or to see my stats?',
    a: 'No. Stats, rules, payouts, exports, security and support are included with every account. No paid extra changes your rules, your limits or your payouts.',
  },
  {
    q: 'What happens if my payment succeeds but my account is not created?',
    a: 'You see a truthful pending or failed status. We retry a bounded number of times, then escalate to our team. Your payment is recorded and you are entitled to a remedy.',
  },
  {
    q: 'Which countries can buy an account?',
    a: 'Adults outside sanctioned jurisdictions, one account each. The list is a legal question and is not published yet. Identity is verified before your first payout, not before you buy.',
    link: { href: '/rules#policies', label: 'Eligibility policy draft' },
  },
  {
    q: 'Can I get a refund?',
    a: 'Full refund before your credentials are issued, and within 7 days if you have placed no trades. Once traded, the account has been delivered.',
    link: { href: '/rules#policies', label: 'Refund policy draft' },
  },
  {
    q: 'Can I use a bot or an EA?',
    a: 'Execution tools are fine. A fully autonomous system needs written approval first. Anything whose edge comes from the simulated fill model is prohibited outright.',
    link: { href: '/rules#policies', label: 'Automation policy draft' },
  },
  {
    q: 'Can I trade the news?',
    a: 'Yes. No blackout windows, and your limits do not change around releases. Fills in fast markets can differ sharply from your screen, and a gap through your stop is still a breach.',
  },
  {
    q: 'What happens when I hit the lifetime payout cap?',
    a: 'That account is complete. A reset restores the balance but not payout capacity, so continuing means buying a new account. We will not sell you a reset that cannot pay out.',
    link: { href: '/payouts#caps', label: 'Lifetime cap by account' },
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl sm:text-4xl">Frequently asked questions</h1>
      <p className="no-caps mt-3 text-fg-muted">
        Where something has not been decided, this page says so rather than guessing.
      </p>

      <div className="mt-8 space-y-2">
        {FAQS.map((faq) => (
          <Accordion key={faq.q} title={faq.q}>
            <p>{faq.a}</p>
            {faq.link && (
              <p className="mt-2">
                <Link href={faq.link.href} className="text-accent hover:underline">
                  {faq.link.label} &rarr;
                </Link>
              </p>
            )}
          </Accordion>
        ))}
      </div>
    </div>
  );
}
