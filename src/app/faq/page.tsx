import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = { title: 'Frequently asked questions' };

const FAQS: { q: string; a: React.ReactNode }[] = [
  {
    q: 'Is this real money trading?',
    a: (
      <>
        No. All trading in this program is simulated. Your orders do not reach a live exchange. The
        account size you buy is a nominal figure used to measure performance, not cash held for you.
        What you can earn is a real cash reward calculated against simulated profits.
      </>
    ),
  },
  {
    q: 'If I have a $50,000 account, do you hold $50,000 for me?',
    a: (
      <>
        No. Nothing is held for you and the simulated balance cannot itself be withdrawn. A $500
        gross withdrawal reduces your simulated account by $500 and pays you $250 in real cash from
        company funds. The other $250 is not paid to anyone — it is simulated balance that ceases to
        exist.
      </>
    ),
  },
  {
    q: 'Is there an evaluation or a profit target?',
    a: <>No. There is no evaluation phase and no profit target to pass before you can trade.</>,
  },
  {
    q: 'Is there a consistency rule or a best-day test?',
    a: (
      <>
        No. There is no consistency rule and no best-day concentration test. A single large winning
        day does not disqualify a payout.
      </>
    ),
  },
  {
    q: 'How soon can I request a payout?',
    a: (
      <>
        As soon as you meet the published conditions, including on your first trading day. There is
        no minimum number of trading days and no minimum number of winning days. You need your
        simulated balance to exceed your starting balance plus your retained buffer by at least the
        $500 minimum gross, flat positions, no working orders, an active account and current
        account data.
      </>
    ),
  },
  {
    q: 'Will the cash reach my bank the same day?',
    a: (
      <>
        We cannot promise that. Same-day <em>eligibility</em> is a rule about when you can request a
        payout. When the money actually arrives depends on the payment rails, your identity
        verification status and banking cut-off times. Your dashboard shows eligibility, processing
        and settlement separately so you can see which stage you are at.
      </>
    ),
  },
  {
    q: 'What is the retained buffer? Is it a target I have to hit?',
    a: (
      <>
        It is not a target and it is not an evaluation. It is an amount of profit that stays in the
        simulated account. It affects when a withdrawal becomes available and how much — nothing
        else. On the $50,000 account the buffer is $2,000, so your first $500 gross withdrawal
        becomes available at a simulated balance of $52,500.
      </>
    ),
  },
  {
    q: 'Does a withdrawal count against my daily loss limit?',
    a: (
      <>
        No. A withdrawal reduces your equity but it is not a trading loss, so it is excluded from
        the daily loss calculation. It does reduce the room you have above your trailing threshold,
        because your threshold does not move down.
      </>
    ),
  },
  {
    q: 'Does my trailing threshold go back down if I give back profit?',
    a: (
      <>
        No. Your threshold follows your highest observed equity upward — including unrealized gains
        on open positions — and never moves back down, whether you lose money trading or take a
        withdrawal. It stops rising once it reaches your starting balance plus $100.
      </>
    ),
  },
  {
    q: 'Is this a subscription?',
    a: (
      <>
        No. Each account is a one-time purchase. There is no recurring billing and nothing renews
        automatically.
      </>
    ),
  },
  {
    q: 'Do I have to buy an add-on to get paid, or to see my stats?',
    a: (
      <>
        No. Account statistics, the rules that apply to you, payout eligibility, requesting and
        receiving a payout, basic exports, account security and ordinary support are included with
        every account. No paid extra changes your rules, your limits or your payouts.
      </>
    ),
  },
  {
    q: 'What happens if my payment succeeds but my account is not created?',
    a: (
      <>
        You will see a truthful pending or failed status — we will not tell you an account exists
        when it does not. We retry automatically a bounded number of times, then escalate to our
        team. Your payment is recorded and you are entitled to support and to a remedy under the
        refund policy.
      </>
    ),
  },
  {
    q: 'Which countries can buy an account?',
    a: (
      <>
        Geographic eligibility has not yet been settled and is marked as outstanding in our{' '}
        <Link href="/legal/trader-agreement" className="text-accent hover:underline">
          trader agreement
        </Link>
        . We are not going to guess at it here.
      </>
    ),
  },
  {
    q: 'Can I get a refund?',
    a: (
      <>
        The refund and cancellation policy has not been settled. It is marked as outstanding in our{' '}
        <Link href="/legal/purchase-and-refund-terms" className="text-accent hover:underline">
          purchase terms
        </Link>
        , and accounts are not sold for real money until it is resolved.
      </>
    ),
  },
];

export default function FaqPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
        Frequently asked questions
      </h1>
      <p className="mt-3 text-fg-muted">
        Where something has not been decided, this page says so rather than guessing.
      </p>

      <dl className="mt-10 space-y-8">
        {FAQS.map((faq) => (
          <div key={faq.q}>
            <dt className="font-semibold text-lg">{faq.q}</dt>
            <dd className="mt-2 text-fg-muted leading-relaxed">{faq.a}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
