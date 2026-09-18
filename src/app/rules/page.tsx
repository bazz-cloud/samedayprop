import type { Metadata } from 'next';
import Link from 'next/link';
import { getPlanViews } from '@/server/views/catalog-view';
import { Badge, Callout, Card } from '@/components/ui';

export const metadata: Metadata = {
  title: 'Rules and how it works',
  description: 'The complete rules that apply to every simulated account, with worked examples.',
};

function tone(status: string) {
  if (status === 'CONFIRMED') return 'accent' as const;
  if (status === 'PROPOSED') return 'warn' as const;
  if (status === 'EXTERNAL') return 'info' as const;
  return 'danger' as const;
}

export default function RulesPage() {
  const plans = getPlanViews();

  return (
    <div className="mx-auto max-w-4xl px-4 py-12 space-y-12">
      <header>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Rules and how it works</h1>
        <p className="mt-3 text-fg-muted leading-relaxed">
          Every limit that applies to your account is listed here, with the arithmetic behind it.
          Terms marked as proposed are development defaults that have not yet been commercially
          approved, and accounts are not sold for real money while any of them remain unapproved.
        </p>
      </header>

      <section aria-labelledby="not-included" className="space-y-3">
        <h2 id="not-included" className="text-2xl font-bold tracking-tight">
          What this program does not have
        </h2>
        <div className="grid gap-3 sm:grid-cols-2">
          {[
            ['No evaluation phase', 'You do not have to pass a challenge or hit a profit target before trading a funded simulated account.'],
            ['No consistency rule', 'There is no best-day concentration test. One large winning day does not disqualify a payout.'],
            ['No minimum trading days', 'Eligibility can be reached on your first trading day.'],
            ['No minimum winning days', 'The number of green days you have is not part of eligibility.'],
          ].map(([title, body]) => (
            <Card key={title} className="p-4">
              <p className="font-semibold text-accent">{title}</p>
              <p className="text-sm text-fg-muted mt-1 leading-relaxed">{body}</p>
            </Card>
          ))}
        </div>
      </section>

      <section aria-labelledby="drawdown" className="space-y-4">
        <h2 id="drawdown" className="text-2xl font-bold tracking-tight">
          Intraday trailing drawdown
        </h2>
        <p className="text-fg-muted leading-relaxed">
          Your account has a threshold that your equity must stay above. It follows your equity
          upward through the day, <strong className="text-fg">including unrealized gains on open
          positions</strong>, and it never moves back down.
        </p>
        <Card className="p-5 font-mono text-sm space-y-1 text-fg-muted">
          <p>S = your starting simulated balance</p>
          <p>D = your account&apos;s drawdown allowance</p>
          <p>H = the highest equity observed on your account, starting at S</p>
          <p className="text-accent pt-2">threshold = min(S + $100, H &minus; D)</p>
        </Card>
        <ul className="space-y-2 text-fg-muted leading-relaxed">
          <li>
            &bull; H rises when your open position marks up, not only when you close a trade.
          </li>
          <li>
            &bull; Neither H nor your threshold ever falls. Giving back an intraday peak does not
            give you the drawdown room back.
          </li>
          <li>
            &bull; A withdrawal reduces your equity but does not move your threshold, so it does
            reduce the room you have left.
          </li>
          <li>
            &bull; Once the threshold reaches your starting balance plus $100 it stops rising, so a
            profitable account keeps a small floor.
          </li>
          <li>
            &bull; Equity <strong className="text-fg">touching</strong> the threshold is a maximum drawdown breach,
            not only falling below it. A breach ends trading access on that account.
          </li>
        </ul>
        <Callout tone="neutral" title="Worked example on the $50,000 account">
          You start at $50,000 with a $2,000 allowance, so your threshold begins at $48,000. You run
          the account up to $52,500 intraday, which lifts your threshold to $50,100 — the stopping
          point. You then withdraw $500 gross. Your equity falls to $52,000, your threshold stays at
          $50,100, and you have $1,900 of loss allowance remaining.
        </Callout>
      </section>

      <section aria-labelledby="daily" className="space-y-4">
        <h2 id="daily" className="text-2xl font-bold tracking-tight">Daily loss limit</h2>
        <p className="text-fg-muted leading-relaxed">
          Separately from the trailing threshold, each account has a maximum loss for one trading
          session. It is measured on your session trading results — realized and unrealized,
          after commissions and fees.
        </p>
        <Callout tone="accent" title="Withdrawals are not trading losses">
          If you withdraw $2,000 gross and then trade flat, your equity is $2,000 lower but your
          daily loss is zero. Withdrawal deductions are excluded from the daily loss calculation.
          They do still reduce your equity, so they reduce your remaining trailing room.
        </Callout>
        <p className="text-fg-muted leading-relaxed">
          Reaching the daily loss limit flattens your positions and locks trading until the Globex
          reopen at 18:00 ET — an hour after the session roll that refreshes your allowance. Sessions roll at 17:00 America/New_York, handled correctly across daylight-saving
          changes, so you always get exactly one daily allowance per session.
        </p>
      </section>

      <section aria-labelledby="positions" className="space-y-4">
        <h2 id="positions" className="text-2xl font-bold tracking-tight">Position limits</h2>
        <p className="text-fg-muted leading-relaxed">
          Minis and micros share one combined ceiling, counted in micro-equivalent units at ten
          micros per mini. A &ldquo;4 minis or 40 micros&rdquo; account has a single limit of 40
          units, not two separate limits.
        </p>
        <ul className="space-y-2 text-fg-muted leading-relaxed">
          <li>
            &bull; Working entry orders count toward the ceiling as well as filled positions, so two
            orders cannot both fill and push you past it.
          </li>
          <li>
            &bull; In a bracket or OCO set only the largest leg counts, because only one of them can
            fill.
          </li>
          <li>
            &bull; Orders that would only reduce a position do not reduce your counted exposure,
            because an order that has not filled may never fill.
          </li>
          <li>
            &bull; Different instruments are not netted against each other. Being long the S&amp;P
            and short the Nasdaq is two positions worth of risk, not zero.
          </li>
          <li>
            &bull; Instruments without approved risk controls cannot be traded at all. We do not
            assume every futures contract carries the same dollar risk.
          </li>
        </ul>
      </section>

      <section aria-labelledby="payouts" className="space-y-4">
        <h2 id="payouts" className="text-2xl font-bold tracking-tight">Payouts</h2>
        <Card className="p-5 font-mono text-sm space-y-1 text-fg-muted">
          <p>A = your reconciled simulated balance</p>
          <p>S = your starting simulated balance</p>
          <p>B = your retained profit buffer</p>
          <p>C = your remaining daily cash capacity</p>
          <p>L = your remaining lifetime cash capacity, where a cap applies</p>
          <p className="text-accent pt-2">
            max gross = min(A &minus; S &minus; B, 2C, 2L, room above your threshold)
          </p>
          <p className="text-fg-subtle">rounded down to a whole dollar; you are paid half in cash</p>
        </Card>
        <p className="text-fg-muted leading-relaxed">
          You must be flat with no working orders, your account must be active, and we must have
          current authoritative data for it. Capacity is reserved when you request, not when you are
          paid, so several requests share the same daily cap and a pending request keeps counting
          against the day it was made.
        </p>
        <p className="text-fg-subtle text-sm leading-relaxed">
          Eligibility, processing and settlement are shown separately in your dashboard. We do not
          guarantee that cash reaches your bank on any particular day.
        </p>
      </section>

      <section aria-labelledby="by-account" className="space-y-4">
        <h2 id="by-account" className="text-2xl font-bold tracking-tight">Limits by account size</h2>
        <div className="overflow-x-auto -mx-4 px-4">
          <table className="w-full text-sm min-w-[46rem]">
            <caption className="sr-only">
              Limits and prices for each simulated account size
            </caption>
            <thead>
              <tr className="border-b border-border-strong text-left text-fg-subtle">
                <th scope="col" className="py-2 pr-4 font-medium">Account</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Price</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">With code</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Positions</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Daily loss</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Drawdown</th>
                <th scope="col" className="py-2 pr-4 font-medium text-right">Buffer</th>
                <th scope="col" className="py-2 font-medium text-right">Daily cash cap</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((plan) => (
                <tr key={plan.key} className="border-b border-border">
                  <th scope="row" className="py-3 pr-4 font-semibold text-left">{plan.label}</th>
                  <td className="py-3 pr-4 tnum text-right text-fg-subtle">{plan.listPrice.display}</td>
                  <td className="py-3 pr-4 tnum text-right text-accent">{plan.couponPrice.display}</td>
                  <td className="py-3 pr-4 tnum text-right">
                    {plan.positionCeiling.minis} / {plan.positionCeiling.micros}
                    {plan.positionCeiling.status !== 'CONFIRMED' && (
                      <span className="block text-xs text-danger">not finalised</span>
                    )}
                  </td>
                  <td className="py-3 pr-4 tnum text-right">{plan.dailyLossLimit.display}</td>
                  <td className="py-3 pr-4 tnum text-right">{plan.drawdownAllowance.display}</td>
                  <td className="py-3 pr-4 tnum text-right">{plan.retainedBuffer.display}</td>
                  <td className="py-3 tnum text-right">{plan.dailyCashCap.display}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 pt-2">
          <Badge tone={tone('CONFIRMED')}>Confirmed</Badge>
          <Badge tone={tone('PROPOSED')}>Proposed — not yet approved</Badge>
          <Badge tone={tone('UNRESOLVED')}>Not yet decided</Badge>
        </div>
        <p className="text-sm text-fg-subtle leading-relaxed">
          Prices and position ceilings for the $25,000, $50,000, $100,000 and $150,000 accounts are
          confirmed. Every daily loss limit, drawdown allowance and buffer above is a proposed
          development default. The $300,000 position ceiling and every lifetime payout
          cap are undecided. Accounts are not sold for real money while these remain open.
        </p>
      </section>

      <p className="text-sm text-fg-subtle">
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
