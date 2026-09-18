import type { Metadata } from 'next';
import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { Badge, Callout, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Payouts',
  description:
    'How payouts work: eligibility, the 50/50 split, daily caps, processing stages and the exact arithmetic.',
};

/**
 * Dedicated payouts page.
 *
 * Every firm in this category gives payouts their own page, because it is the
 * question traders actually arrive with. The page follows their structure —
 * eligibility, amounts, timing, method, FAQ — with our own rules and arithmetic
 * in it, and with the distinction those pages tend to blur made explicit:
 * eligibility, processing and settlement are three different things.
 */
export default function PayoutsPage() {
  const plans = getPlanViews();
  const fiftyK = plans.find((p) => p.key === 'SIM_50K')!;

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 space-y-14">
      <header>
        <p className="text-accent font-medium text-sm uppercase tracking-wider">Payouts</p>
        <h1 className="mt-3 text-3xl sm:text-4xl font-bold tracking-tight">
          Same-day eligible, including your first trading day
        </h1>
        <p className="mt-4 text-fg-muted max-w-3xl leading-relaxed">
          There is no minimum number of trading days, no minimum number of winning days, and no
          consistency or best-day test. If your account meets the published conditions on day one,
          you can request a payout on day one.
        </p>
        <div className="mt-5 flex flex-wrap gap-2">
          <Badge tone="accent">No minimum trading days</Badge>
          <Badge tone="accent">No consistency rule</Badge>
          <Badge tone="accent">No best-day test</Badge>
          <Badge tone="accent">No evaluation to pass first</Badge>
        </div>
      </header>

      {/* ---------------------------------------------------------- 1 */}
      <section aria-labelledby="eligibility" className="space-y-4">
        <h2 id="eligibility" className="text-2xl font-bold tracking-tight">
          1. When you can request
        </h2>
        <p className="text-fg-muted leading-relaxed">
          All of the following have to be true. Your dashboard shows each one and tells you which is
          holding you back.
        </p>
        <ul className="grid gap-3 sm:grid-cols-2">
          {[
            [
              'Profit above your buffer',
              `Your simulated balance must exceed your starting balance plus your retained buffer by at least the ${fiftyK.firstWithdrawalGross.display} minimum gross.`,
            ],
            ['Flat positions', 'No open positions when you request.'],
            ['No working orders', 'Cancel anything still resting in the book.'],
            ['Account active', 'Not paused for a daily loss breach, not breached on the trailing threshold.'],
            [
              'Current account data',
              'We need fresh authoritative data from the platform. If your account has gone quiet, payouts are blocked until it reconciles rather than paid against figures we cannot verify.',
            ],
            [
              'Room above your threshold',
              'The withdrawal must not take your equity to your trailing threshold. A payout is never what trips a breach.',
            ],
          ].map(([title, body]) => (
            <li key={title}>
              <Card className="p-4 h-full">
                <p className="font-medium">{title}</p>
                <p className="text-sm text-fg-muted mt-1 leading-relaxed">{body}</p>
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {/* ---------------------------------------------------------- 2 */}
      <section aria-labelledby="amount" className="space-y-4">
        <h2 id="amount" className="text-2xl font-bold tracking-tight">
          2. How much you can take
        </h2>
        <Card className="p-5 font-mono text-sm space-y-1 text-fg-muted">
          <p>A = your reconciled simulated balance</p>
          <p>S = your starting simulated balance</p>
          <p>B = your retained profit buffer</p>
          <p>C = your remaining daily cash capacity</p>
          <p>L = your remaining lifetime cash capacity, where a cap applies</p>
          <p className="text-accent pt-2">
            max gross = min(A &minus; S &minus; B, 2C, 2L, room above threshold)
          </p>
          <p className="text-fg-subtle">
            rounded down to a whole dollar &middot; you receive half in cash
          </p>
        </Card>

        <Callout tone="accent" title="Worked example on the $50,000 account">
          <table className="w-full mt-2 text-sm">
            <tbody>
              {[
                ['Starting simulated balance', fiftyK.startingBalance.display],
                ['Retained profit buffer', fiftyK.retainedBuffer.display],
                ['First payout available at', fiftyK.firstWithdrawalAt.display],
                ['Gross withdrawal requested', fiftyK.firstWithdrawalGross.display],
                ['Real cash paid to you', fiftyK.firstWithdrawalCash.display],
                ['Simulated balance remaining', fiftyK.firstWithdrawalLeaves.display],
              ].map(([label, value]) => (
                <tr key={label}>
                  <td className="py-1 pr-4">{label}</td>
                  <td className="py-1 text-right tnum font-medium">{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-3 text-xs">
            At a balance of <span className="tnum">$52,499.00</span> the available gross would be
            $499 &mdash; below the $500 minimum &mdash; so no payout would be available yet.
          </p>
        </Callout>
      </section>

      {/* ---------------------------------------------------------- 3 */}
      <section aria-labelledby="split" className="space-y-4">
        <h2 id="split" className="text-2xl font-bold tracking-tight">
          3. The 50/50 split, stated plainly
        </h2>
        <p className="text-fg-muted leading-relaxed">
          You keep <strong className="text-fg">50%</strong> of any gross withdrawal, paid to you in
          real cash. This is lower than the 80&ndash;90% splits advertised elsewhere in this
          industry, and it is lower for a reason worth understanding: those splits are paid against
          accounts you first have to pass an evaluation to reach, usually on a monthly subscription,
          and usually under a consistency rule that decides how much of your profit counts. This
          program has none of those. You buy the account once and you can request a payout on your
          first trading day.
        </p>
        <Card className="p-5">
          <p className="text-sm text-fg-muted leading-relaxed">
            A <span className="tnum text-fg">$500</span> gross withdrawal:
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            <li className="flex justify-between gap-4 border-b border-border pb-2">
              <span className="text-fg-muted">Deducted from your simulated account</span>
              <span className="tnum">$500.00</span>
            </li>
            <li className="flex justify-between gap-4 border-b border-border pb-2">
              <span className="text-fg-muted">Paid to you in real cash</span>
              <span className="tnum text-accent font-semibold">$250.00</span>
            </li>
            <li className="flex justify-between gap-4">
              <span className="text-fg-muted">Received by anyone else</span>
              <span className="tnum">$0.00</span>
            </li>
          </ul>
          <p className="text-xs text-fg-subtle mt-3 leading-relaxed">
            The other $250 is not income to us. It is simulated balance that ceases to exist. We say
            this because the arithmetic is otherwise easy to misread as a fee.
          </p>
        </Card>
      </section>

      {/* ---------------------------------------------------------- 4 */}
      <section aria-labelledby="caps" className="space-y-4">
        <h2 id="caps" className="text-2xl font-bold tracking-tight">
          4. Caps by account size
        </h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">Payout caps and first-payout thresholds per account</caption>
            <thead>
              <tr className="border-b border-border-strong text-left text-fg-subtle">
                <th scope="col" className="py-2 pr-4 font-medium">Account</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Retained buffer</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">First payout at</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Daily cash cap</th>
                <th scope="col" className="py-2 font-medium text-right">Gross equivalent</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.key} className="border-b border-border">
                  <th scope="row" className="py-3 pr-4 font-semibold text-left">{plan.label}</th>
                  <td className="py-3 pr-4 tnum text-right">{plan.retainedBuffer.display}</td>
                  <td className="py-3 pr-4 tnum text-right">{plan.firstWithdrawalAt.display}</td>
                  <td className="py-3 pr-4 tnum text-right text-accent">{plan.dailyCashCap.display}</td>
                  <td className="py-3 tnum text-right text-fg-subtle">
                    {plan.dailyGrossEquivalent.display}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-sm text-fg-subtle leading-relaxed">
          Capacity is reserved when you request, not when you are paid, so several requests share the
          same day&rsquo;s cap and a pending request keeps counting against the day it was made.
        </p>
      </section>

      {/* ---------------------------------------------------------- 5 */}
      <section aria-labelledby="timing" className="space-y-4">
        <h2 id="timing" className="text-2xl font-bold tracking-tight">
          5. Eligibility, processing and settlement are three different things
        </h2>
        <p className="text-fg-muted leading-relaxed">
          Firms in this industry often compress these into one number. We show them separately in
          your dashboard, because they are governed by different things and only the first is fully
          in our control.
        </p>
        <ol className="space-y-3">
          {[
            [
              'Eligibility',
              'Determined entirely by the published rules above. This is what "same-day" refers to: you can become eligible on your first trading day.',
            ],
            [
              'Processing',
              'A request that meets every requirement can be approved automatically. One that needs review shows you the specific reason — we do not use routine review to impose an undisclosed waiting period.',
            ],
            [
              'Settlement',
              'When the money actually lands depends on the payment rails, your identity verification status and banking cut-off times. We do not guarantee same-day receipt of funds in your bank account, and you should be sceptical of anyone who does.',
            ],
          ].map(([title, body], index) => (
            <li key={title} className="flex gap-4">
              <span
                aria-hidden="true"
                className="shrink-0 h-7 w-7 rounded-full border border-accent/40 bg-accent-dim grid place-items-center text-accent text-xs font-semibold"
              >
                {index + 1}
              </span>
              <div>
                <p className="font-medium">{title}</p>
                <p className="text-sm text-fg-muted mt-1 leading-relaxed">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------------------------------------------------------- 6 */}
      <section aria-labelledby="payout-faq" className="space-y-4">
        <h2 id="payout-faq" className="text-2xl font-bold tracking-tight">
          Payout questions
        </h2>
        <dl className="space-y-6">
          {[
            [
              'Do I have to trade a minimum number of days first?',
              'No. There is no minimum trading day requirement and no minimum number of winning days.',
            ],
            [
              'Is there a consistency rule?',
              'No. There is no consistency rule and no best-day concentration test. A single large winning day does not reduce or disqualify a payout. This is a deliberate difference from most firms in this category, several of which apply a 20–40% best-day cap at payout time.',
            ],
            [
              'Does a withdrawal count against my daily loss limit?',
              'No. A withdrawal lowers your equity but it is not a trading loss, so it is excluded from the daily loss calculation. It does reduce the room you have above your trailing threshold, because that threshold never moves down.',
            ],
            [
              'Can I request more than once a day?',
              'Yes, up to the daily cash cap for your account. Capacity is reserved at request time, so multiple requests share the same day’s cap.',
            ],
            [
              'What happens if a payment fails?',
              'If our payment provider confirms no money was sent, the simulated deduction is reversed and your capacity is released. If the outcome is genuinely unknown, the request is held for reconciliation and nothing is reversed until we have a definite answer — reversing on an unknown outcome could pay the same profit twice.',
            ],
            [
              'Can a later breach cancel a payout I already earned?',
              'No. A payout you validly earned is not voided by a later unrelated change to your account status. Any review of an earned payout is recorded with its reason and shown to you.',
            ],
          ].map(([q, a]) => (
            <div key={q}>
              <dt className="font-semibold">{q}</dt>
              <dd className="mt-1.5 text-fg-muted leading-relaxed">{a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <Callout tone="neutral">
        We do not publish payout screenshots, totals paid or trader counts. We have not operated long
        enough for any such figure to be real, and a number we cannot stand behind is worse than no
        number. The rules above are the commitment.
      </Callout>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/accounts"
          className="rounded-lg bg-accent px-6 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
        >
          Choose an account
        </Link>
        <Link
          href="/legal/payout-policy"
          className="rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent hover:text-accent transition-colors"
        >
          Read the payout policy
        </Link>
      </div>
    </div>
  );
}
