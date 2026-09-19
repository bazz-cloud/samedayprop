import type { Metadata } from 'next';
import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import {
  Accordion,
  Chip,
  FormulaCard,
  SpecTable,
  StatGrid,
  StatPair,
  type Status,
} from '@/components/system';
import { DrawdownDiagram } from '@/components/DrawdownDiagram';
import { RulesBrowser, type RuleSection } from '@/components/RulesBrowser';
import { PositionCeilingGraphic } from '@/components/PositionCeilingGraphic';
import { POLICY_DRAFTS, type PolicyStance } from '@/domain/policy/policies';

export const metadata: Metadata = {
  title: 'Rules and how it works',
  description: 'The complete rules that apply to every simulated account, with worked examples.',
};

function asStatus(status: string): Status {
  if (status === 'CONFIRMED' || status === 'PROPOSED' || status === 'EXTERNAL') return status;
  return 'UNRESOLVED';
}

function stanceLabel(stance: PolicyStance) {
  if (stance === 'PERMITTED') return 'Allowed';
  if (stance === 'PROHIBITED') return 'Not allowed';
  if (stance === 'CONDITIONAL') return 'Allowed with limits';
  return 'How it works';
}

export default function RulesPage() {
  const plans = getPlanViews();
  const fiftyK = plans.find((p) => p.key === 'SIM_50K')!;
  const unapproved = [
    ...new Map(
      plans.flatMap((plan) => plan.launchBlockers).map((blocker) => [blocker.field, blocker]),
    ).values(),
  ];

  const tierRows = (pick: (plan: (typeof plans)[number]) => readonly string[]) =>
    plans.map((plan) => ({ planKey: plan.key, label: plan.label, values: pick(plan) }));

  /**
   * The rulebook, as data.
   *
   * Each card carries its own table across all five sizes so nobody has to jump
   * back to pricing, and each caveat is attached to the rule it qualifies rather
   * than stacked with seven others at the foot of the page.
   */
  const sections: RuleSection[] = [
    {
      id: 'ends-account',
      title: 'What ends your account',
      cards: [
        {
          id: 'trailing',
          title: 'Trailing drawdown',
          summary: 'Touch the floor and the account ends.',
          body: [
            'A threshold follows your equity upward, including unrealized gains on open positions, and never moves back down. Once it reaches your starting balance plus $100 it stops rising.',
            'Equity touching the threshold is a breach, not only falling below it.',
          ],
          table: {
            columns: ['Account', 'Allowance', 'Floor starts at', 'Floor stops at'],
            rows: tierRows((plan) => [
              plan.drawdownAllowance.display,
              plan.initialThreshold.display,
              plan.trailingStopAt.display,
            ]),
          },
          caveat:
            'A withdrawal lowers your equity without moving the threshold, so it spends the room between them.',
        },
        {
          id: 'daily-loss',
          title: 'Daily loss limit',
          summary: 'Lose your daily limit and you are locked out until 18:00 ET.',
          body: [
            'Measured on your session trading results, realized and unrealized, after commissions and fees. Reaching it flattens your positions.',
            'Sessions roll at 17:00 ET. Trading reopens an hour later at the Globex reopen.',
          ],
          table: {
            columns: ['Account', 'Daily loss limit'],
            rows: tierRows((plan) => [plan.dailyLossLimit.display]),
          },
          caveat:
            'Withdrawals are not trading losses. Withdraw $2,000 and trade flat and your daily loss is zero, though your trailing room is still reduced.',
        },
        {
          id: 'positions',
          title: 'Position limits',
          summary: 'Minis and micros share one ceiling. 1 mini = 10 micros.',
          body: [
            'Working entry orders count toward the ceiling, not just filled positions. In a bracket or OCO set only the largest leg counts.',
            'Instruments are not netted against each other, and an instrument without approved risk controls cannot be traded at all.',
          ],
          table: {
            columns: ['Account', 'Minis', 'Micros'],
            rows: tierRows((plan) => [
              String(plan.positionCeiling.minis),
              String(plan.positionCeiling.micros),
            ]),
          },
        },
      ],
    },
    {
      id: 'payout-eligibility',
      title: 'Payout eligibility',
      cards: [
        {
          id: 'eligibility',
          title: 'When you can withdraw',
          summary: 'You keep 50% of gross, in cash, the same day.',
          body: [
            'Your balance must exceed your starting balance plus your buffer by at least $500 gross. You must be flat, with no working orders, on an active account we hold current data for.',
            'Capacity is reserved when you request, not when you are paid, so a pending request keeps counting against the day it was made.',
          ],
          table: {
            columns: ['Account', 'Buffer', 'First payout at', 'Daily cash cap', 'Lifetime cap'],
            rows: tierRows((plan) => [
              plan.retainedBuffer.display,
              plan.firstWithdrawalAt.display,
              plan.dailyCashCap.display,
              plan.lifetimeCapResolved
                ? (plan.lifetimeCapDescription.split(' ')[0] ?? '—')
                : 'Not decided',
            ]),
          },
          caveat:
            'Eligibility, processing and settlement are three different things. We do not guarantee same-day receipt of funds in your bank account, and you should be sceptical of anyone who does.',
        },
        {
          id: 'resets',
          title: 'Resets',
          summary: 'Breached an account? Reset it for $10 less than a new one.',
          body: [
            'A reset restores your starting balance, high-water mark and threshold. It is available once an account can no longer trade, and not while a payout request is in progress.',
            'A daily loss lockout needs no reset. It lifts by itself at the next market open.',
          ],
          caveat:
            'A reset does not restore lifetime payout capacity you have already used. An account at its lifetime cap cannot be usefully reset, and we will not sell you one.',
        },
      ],
    },
  ];

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-12">
      <header>
        <h1 className="text-3xl sm:text-4xl">Rules and how it works</h1>
        <p className="no-caps mt-3 text-fg-muted">
          Every limit on your account, with the arithmetic behind it.
        </p>
      </header>

      {/* The three things that end an account, first and in red. A visitor who
          reads nothing else on this page should still leave knowing these. */}
      <section aria-labelledby="immediate" className="space-y-3">
        <h2 id="immediate" className="text-xl text-danger">
          These end your account immediately
        </h2>
        <div className="grid gap-3 md:grid-cols-3">
          {[
            {
              title: 'Touching the trailing floor',
              detail: `On the ${fiftyK.label} account the floor starts at ${fiftyK.initialThreshold.display} and only rises.`,
            },
            {
              title: 'Breaching the daily loss limit',
              detail: `${fiftyK.dailyLossLimit.display} on the ${fiftyK.label} account. Positions are flattened and trading locks until 18:00 ET.`,
            },
            {
              title: 'Exceeding position limits',
              detail: `${fiftyK.positionCeiling.minis} minis or ${fiftyK.positionCeiling.micros} micros on the ${fiftyK.label} account, counted as one shared ceiling.`,
            },
          ].map((item) => (
            <div
              key={item.title}
              className="rounded-xl border border-border-strong bg-card-danger p-4"
            >
              <p className="no-caps font-bold">{item.title}</p>
              <p className="no-caps mt-1.5 text-sm text-fg-muted leading-relaxed">{item.detail}</p>
            </div>
          ))}
        </div>
        <p className="no-caps text-xs text-fg-fine">
          A breach ends trading on that account. The fee is not refunded.
        </p>
      </section>

      <RulesBrowser sections={sections} />

      <section aria-labelledby="drawdown" className="space-y-4">
        <h2 id="drawdown" className="text-2xl">
          Intraday trailing drawdown
        </h2>
        <p className="no-caps font-bold text-lg">
          A threshold follows your equity up and never comes back down.
        </p>
        <DrawdownDiagram />
        <FormulaCard
          formula="threshold = min(S + $100, H − D)"
          variables={[
            { symbol: 'S', meaning: 'Your starting simulated balance' },
            { symbol: 'D', meaning: "Your account's drawdown allowance" },
            { symbol: 'H', meaning: 'Highest equity observed, including unrealized gains' },
          ]}
          caption="Equity touching the threshold is a breach, not only falling below it. A breach ends trading on that account."
        />
        <SpecTable
          caption={`Worked example on the ${fiftyK.label} account`}
          columns={[
            { key: 'event', label: 'Event' },
            { key: 'equity', label: 'Equity', numeric: true },
            { key: 'threshold', label: 'Threshold', numeric: true },
            { key: 'room', label: 'Room left', numeric: true },
          ]}
          rows={[
            { event: 'Account opens', equity: '$50,000', threshold: '$48,000', room: '$2,000' },
            { event: 'Runs up to $52,500', equity: '$52,500', threshold: '$50,100', room: '$2,400' },
            { event: 'Withdraw $500 gross', equity: '$52,000', threshold: '$50,100', room: '$1,900' },
            {
              event: 'Falls to $50,100',
              equity: '$50,100',
              threshold: '$50,100',
              room: <span className="font-bold">$0 — breach</span>,
            },
          ]}
        />
      </section>

      <section aria-labelledby="daily" className="space-y-4">
        <h2 id="daily" className="text-2xl">
          Daily loss limit
        </h2>
        <p className="no-caps font-bold text-lg">
          Lose your daily limit and you are locked out until 18:00 ET.
        </p>
        <ul className="no-caps space-y-2 text-fg-muted">
          <li className="pl-4 border-l border-border">
            Measured on session trading results, realized and unrealized, after commissions and fees.
          </li>
          <li className="pl-4 border-l border-border">
            Withdrawals are not trading losses. Withdraw $2,000 and trade flat and your daily loss is
            zero.
          </li>
          <li className="pl-4 border-l border-border">
            Withdrawals still lower your equity, so they still reduce your trailing room.
          </li>
          <li className="pl-4 border-l border-border">
            Reaching the limit flattens your positions. Sessions roll at 17:00 ET; trading reopens an
            hour later at the Globex reopen.
          </li>
        </ul>
      </section>

      <section aria-labelledby="positions" className="space-y-4">
        <h2 id="positions" className="text-2xl">
          Position limits
        </h2>
        <p className="no-caps font-bold text-lg">
          Minis and micros share one ceiling. 1 mini = 10 micros.
        </p>
        <PositionCeilingGraphic
          minis={fiftyK.positionCeiling.minis}
          micros={fiftyK.positionCeiling.micros}
        />
        <ul className="no-caps space-y-2 text-fg-muted">
          <li className="pl-4 border-l border-border">
            Working entry orders count toward the ceiling, not just filled positions.
          </li>
          <li className="pl-4 border-l border-border">
            In a bracket or OCO set only the largest leg counts.
          </li>
          <li className="pl-4 border-l border-border">
            Reducing orders do not reduce your counted exposure until they fill.
          </li>
          <li className="pl-4 border-l border-border">
            Instruments are not netted against each other, and unapproved instruments cannot be
            traded at all.
          </li>
        </ul>
      </section>

      <section aria-labelledby="payouts" className="space-y-4">
        <h2 id="payouts" className="text-2xl">
          Payouts
        </h2>
        <p className="no-caps font-bold text-lg">
          You keep 50% of gross, in cash, the same day.
        </p>
        <FormulaCard
          formula="max gross = min(A − S − B, 2C, 2L, room above threshold)"
          variables={[
            { symbol: 'A', meaning: 'Your reconciled simulated balance' },
            { symbol: 'S', meaning: 'Your starting simulated balance' },
            { symbol: 'B', meaning: 'Your retained profit buffer' },
            { symbol: 'C', meaning: 'Remaining daily cash capacity' },
            { symbol: 'L', meaning: 'Remaining lifetime cash capacity' },
          ]}
          caption="Rounded down to a whole dollar. You are paid half in cash."
        />
        <ul className="no-caps space-y-2 text-fg-muted">
          <li className="pl-4 border-l border-border">You are flat, with no working orders.</li>
          <li className="pl-4 border-l border-border">Your account is active.</li>
          <li className="pl-4 border-l border-border">
            We hold current authoritative data for it.
          </li>
          <li className="pl-4 border-l border-border">
            Capacity is reserved when you request, not when you are paid, so a pending request keeps
            counting against the day it was made.
          </li>
        </ul>
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          Eligibility, processing and settlement are shown separately in your dashboard. We do not
          guarantee that cash reaches your bank on any particular day.
        </p>
      </section>

      <section aria-labelledby="resets" className="space-y-4">
        <h2 id="resets" className="text-2xl">
          Resets
        </h2>
        <p className="no-caps font-bold text-lg">
          Breach your drawdown? Reset for $10 less than a new account.
        </p>
        <ul className="no-caps space-y-2 text-fg-muted">
          <li className="pl-4 border-l border-border">
            You keep your platform sign-in and your payout history.
          </li>
          <li className="pl-4 border-l border-border">
            Lifetime payout capacity you have already used stays used. A reset restores your balance,
            not your payout headroom.
          </li>
          <li className="pl-4 border-l border-border">
            Not available while a payout request is in progress, since a reset changes the balance
            that request was checked against.
          </li>
          <li className="pl-4 border-l border-border">
            A daily loss lockout needs no reset. It lifts by itself at the next market open.
          </li>
        </ul>
      </section>

      <section aria-labelledby="not-included" className="space-y-4">
        <h2 id="not-included" className="text-2xl">
          What this program does not have
        </h2>
        <StatGrid>
          <StatPair icon="◆" label="No evaluation phase" />
          <StatPair icon="◆" label="No consistency rule" />
          <StatPair icon="◆" label="No minimum days" />
          <StatPair icon="◆" label="No winning-day rule" />
        </StatGrid>
      </section>

      <section aria-labelledby="by-account" className="space-y-4">
        <h2 id="by-account" className="text-2xl">
          Limits by account size
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            <SpecTable
              caption="Limits and prices for each simulated account size"
              columns={[
                { key: 'account', label: 'Account' },
                { key: 'price', label: 'With code', numeric: true },
                { key: 'positions', label: 'Positions', numeric: true },
                { key: 'dailyLoss', label: 'Daily loss', numeric: true },
                { key: 'drawdown', label: 'Drawdown', numeric: true },
                { key: 'buffer', label: 'Buffer', numeric: true },
                { key: 'dailyCap', label: 'Daily cap', numeric: true },
                { key: 'lifetimeCap', label: 'Lifetime cap', numeric: true },
              ]}
              rows={plans.map((plan) => ({
                account: plan.label,
                price: <span className="text-accent font-bold">{plan.couponPrice.display}</span>,
                positions: (
                  <>
                    {plan.positionCeiling.minis} / {plan.positionCeiling.micros}
                    {plan.positionCeiling.status !== 'CONFIRMED' && (
                      <span className="block mt-1">
                        <Chip status={asStatus(plan.positionCeiling.status)} />
                      </span>
                    )}
                  </>
                ),
                dailyLoss: plan.dailyLossLimit.display,
                drawdown: plan.drawdownAllowance.display,
                buffer: plan.retainedBuffer.display,
                dailyCap: plan.dailyCashCap.display,
                lifetimeCap: plan.lifetimeCapResolved ? (
                  plan.lifetimeCapDescription.split(' ')[0]
                ) : (
                  <Chip status="UNRESOLVED" />
                ),
              }))}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Chip status="CONFIRMED" />
          <Chip status="PROPOSED" />
          <Chip status="UNRESOLVED" />
        </div>
        <p className="no-caps text-sm text-fg-subtle leading-relaxed">
          Accounts are not sold for real money while any term remains unapproved. Terms marked
          proposed are development defaults that have not been commercially approved, and terms
          marked not decided have no value set at all.
          {unapproved.length > 0 && (
            <>
              {' '}
              Still open: {unapproved.map((blocker) => blocker.detail).join(' ')}
            </>
          )}
        </p>
      </section>

      <section aria-labelledby="policies" className="space-y-3">
        <h2 id="policies" className="text-2xl">
          Trading and account policies
        </h2>
        <p className="no-caps text-sm text-fg-muted">
          Every policy below is a draft. Until approved it is not a rule you have agreed to, and it
          is not enforced against your account.
        </p>
        {POLICY_DRAFTS.map(({ value: policy, status }) => (
          <Accordion
            key={policy.key}
            title={policy.title}
            rule={policy.summary}
            status={asStatus(status)}
          >
            <p className="mb-2 text-xs font-bold text-fg-subtle">
              {stanceLabel(policy.stance).toUpperCase()}
            </p>
            <ul className="space-y-2">
              {policy.rules.map((rule) => (
                <li key={rule} className="pl-3 border-l border-border">
                  {rule}
                </li>
              ))}
            </ul>
            {policy.needsLegalReview && (
              <p className="mt-3 text-xs text-fg-subtle">
                Wording subject to legal review and may change before it is published as binding.
              </p>
            )}
          </Accordion>
        ))}
      </section>

      <p className="no-caps text-sm text-fg-subtle">
        The rules above are summarised from the{' '}
        <Link href="/legal/trader-agreement" className="text-accent hover:underline">
          trader agreement
        </Link>{' '}
        and{' '}
        <Link href="/legal/payout-policy" className="text-accent hover:underline">
          payout policy
        </Link>
        , which govern if they differ.
      </p>
    </div>
  );
}
