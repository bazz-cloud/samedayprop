import type { Metadata } from 'next';
import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { Accordion, FormulaCard, SpecTable, StatGrid, StatPair } from '@/components/system';

export const metadata: Metadata = {
  title: 'Payouts',
  description:
    'How payouts work: eligibility, the 50/50 split, daily caps, processing stages and the exact arithmetic.',
};

/**
 * Payouts.
 *
 * The question traders actually arrive with, so it keeps its own page. The
 * distinction the category tends to blur is made explicit and is NOT compressed
 * away: eligibility, processing and settlement are three different things, and
 * only the first is fully in our control.
 */
export default function PayoutsPage() {
  const plans = getPlanViews();
  const fiftyK = plans.find((p) => p.key === 'SIM_50K')!;

  const conditions = [
    'Your balance exceeds your starting balance plus buffer by at least $500.',
    'You are flat, with no open positions.',
    'You have no working orders resting in the book.',
    'Your account is active, not paused and not breached.',
    'We hold current authoritative data for your account.',
    'The withdrawal leaves your equity above your trailing threshold.',
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-12">
      <header>
        <h1 className="text-3xl sm:text-4xl">Payouts</h1>
        <p className="no-caps mt-3 text-xl font-bold leading-snug">
          Request a payout on your first trading day.
        </p>
      </header>

      <section aria-labelledby="none" className="space-y-4">
        <h2 id="none" className="sr-only">
          What does not apply
        </h2>
        <StatGrid>
          <StatPair icon="◆" label="No minimum days" />
          <StatPair icon="◆" label="No consistency rule" />
          <StatPair icon="◆" label="No best-day test" />
          <StatPair icon="◆" label="No evaluation first" />
        </StatGrid>
      </section>

      <section aria-labelledby="eligibility" className="space-y-4">
        <h2 id="eligibility" className="text-2xl">
          When you can request
        </h2>
        <p className="no-caps font-bold text-lg">All six have to be true at once.</p>
        <ul className="space-y-2">
          {conditions.map((condition) => (
            <li key={condition} className="no-caps flex gap-3 text-fg-muted">
              <span aria-hidden="true" className="text-accent font-bold shrink-0">
                ✓
              </span>
              <span>{condition}</span>
            </li>
          ))}
        </ul>
        <p className="no-caps text-sm text-fg-subtle">
          Your dashboard shows each one and names the one holding you back.
        </p>
      </section>

      <section aria-labelledby="amount" className="space-y-4">
        <h2 id="amount" className="text-2xl">
          How much you can take
        </h2>
        <FormulaCard
          formula="max gross = min(A − S − B, 2C, 2L, room above threshold)"
          variables={[
            { symbol: 'A', meaning: 'Your reconciled simulated balance' },
            { symbol: 'S', meaning: 'Your starting simulated balance' },
            { symbol: 'B', meaning: 'Your retained profit buffer' },
            { symbol: 'C', meaning: 'Remaining daily cash capacity' },
            { symbol: 'L', meaning: 'Remaining lifetime cash capacity' },
          ]}
          caption="Rounded down to a whole dollar. You receive half in cash."
        />
        <SpecTable
          caption={`Worked example on the ${fiftyK.label} account`}
          columns={[
            { key: 'item', label: 'Item' },
            { key: 'amount', label: 'Amount', numeric: true },
          ]}
          rows={[
            { item: 'Starting simulated balance', amount: fiftyK.startingBalance.display },
            { item: 'Retained profit buffer', amount: fiftyK.retainedBuffer.display },
            { item: 'First payout available at', amount: fiftyK.firstWithdrawalAt.display },
            { item: 'Balance in this example', amount: fiftyK.exampleWithdrawalAt.display },
            { item: 'Gross withdrawal requested', amount: fiftyK.exampleWithdrawalGross.display },
            {
              item: 'Real cash paid to you',
              amount: (
                <span className="text-accent font-bold">{fiftyK.exampleWithdrawalCash.display}</span>
              ),
            },
            { item: 'Simulated balance remaining', amount: fiftyK.exampleWithdrawalLeaves.display },
            { item: 'Received by anyone else', amount: '$0.00' },
          ]}
        />
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          The other {fiftyK.exampleWithdrawalCash.display} is not income to us. It is simulated
          balance that ceases to exist. That amount is an example, not a minimum: the smallest
          withdrawal on any account is {fiftyK.firstWithdrawalGross.display} gross for{' '}
          {fiftyK.firstWithdrawalCash.display} cash. At <span className="tnum">$52,499.00</span> the
          available gross would be $499, below the $500 minimum, so no payout is available yet.
        </p>
      </section>

      <section aria-labelledby="caps" className="space-y-4">
        <h2 id="caps" className="text-2xl">
          Caps by account size
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[40rem]">
            <SpecTable
              caption="Payout caps and first-payout thresholds per account"
              columns={[
                { key: 'account', label: 'Account' },
                { key: 'buffer', label: 'Buffer', numeric: true },
                { key: 'first', label: 'First payout at', numeric: true },
                { key: 'daily', label: 'Daily cash cap', numeric: true },
                { key: 'gross', label: 'Gross equivalent', numeric: true },
                { key: 'lifetime', label: 'Lifetime cap', numeric: true },
              ]}
              rows={plans.map((plan) => ({
                account: plan.label,
                buffer: plan.retainedBuffer.display,
                first: plan.firstWithdrawalAt.display,
                daily: <span className="text-accent font-bold">{plan.dailyCashCap.display}</span>,
                gross: plan.dailyGrossEquivalent.display,
                lifetime: plan.lifetimeCapDescription.split(' ')[0],
              }))}
            />
          </div>
        </div>
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          Capacity is reserved when you request, not when you are paid, so several requests share the
          same day&rsquo;s cap and a pending request keeps counting against the day it was made.
        </p>
      </section>

      <section aria-labelledby="timing" className="space-y-4">
        <h2 id="timing" className="text-2xl">
          Eligibility, processing and settlement
        </h2>
        <p className="no-caps font-bold text-lg">Three different things. Only the first is ours.</p>
        <SpecTable
          caption="What governs each stage of a payout"
          columns={[
            { key: 'stage', label: 'Stage' },
            { key: 'governed', label: 'Governed by' },
          ]}
          rows={[
            { stage: 'Eligibility', governed: 'The published rules above. This is what same-day means.' },
            { stage: 'Processing', governed: 'Automatic when every requirement is met; a review names its reason.' },
            {
              stage: 'Settlement',
              governed: 'Payment rails, your verification status, and banking cut-off times.',
            },
          ]}
        />
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          We do not guarantee same-day receipt of funds in your bank account, and you should be
          sceptical of anyone who does.
        </p>
      </section>

      <section aria-labelledby="payout-faq" className="space-y-3">
        <h2 id="payout-faq" className="text-2xl">
          Payout questions
        </h2>
        <Accordion
          title="Does a withdrawal count against my daily loss limit?"
          rule="No. It lowers equity, but it is not a trading loss."
        >
          A withdrawal is excluded from the daily loss calculation. It does reduce the room you have
          above your trailing threshold, because that threshold never moves down.
        </Accordion>
        <Accordion
          title="Can I request more than once a day?"
          rule="Yes, up to your daily cash cap."
        >
          Capacity is reserved at request time, so multiple requests share the same day&rsquo;s cap.
        </Accordion>
        <Accordion
          title="What happens if a payment fails?"
          rule="Confirmed failure is reversed. An unknown outcome is not."
        >
          If our payment provider confirms no money was sent, the simulated deduction is reversed and
          your capacity is released. If the outcome is genuinely unknown, the request is held for
          reconciliation and nothing is reversed until we have a definite answer — reversing on an
          unknown outcome could pay the same profit twice.
        </Accordion>
        <Accordion
          title="Can a later breach cancel a payout I already earned?"
          rule="No. An earned payout is not voided by a later change."
        >
          A payout you validly earned is not voided by a later unrelated change to your account
          status. Any review of an earned payout is recorded with its reason and shown to you.
        </Accordion>
        <Accordion
          title="Why is the split 50% and not 90%?"
          rule="You pay once, pass no evaluation, and face no consistency rule."
        >
          Higher advertised splits are paid against accounts you first have to pass an evaluation to
          reach, usually on a monthly subscription, and usually under a consistency rule that decides
          how much of your profit counts. This program has none of those.
        </Accordion>
      </section>

      <p className="no-caps text-sm text-fg-subtle leading-relaxed">
        We do not publish payout screenshots, totals paid or trader counts. We have not operated long
        enough for any such figure to be real. The rules above are the commitment.
      </p>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/accounts"
          className="no-caps rounded-lg bg-accent px-6 py-3 font-bold text-bg hover:bg-accent-strong transition-colors"
        >
          Choose an account
        </Link>
        <Link
          href="/legal/payout-policy"
          className="no-caps rounded-lg border border-border-strong px-6 py-3 font-medium hover:border-accent hover:text-accent transition-colors"
        >
          Read the payout policy
        </Link>
      </div>
    </div>
  );
}
