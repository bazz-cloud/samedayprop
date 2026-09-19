import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { getAccountDetail } from '@/server/views/admin-analytics';
import { requireUser } from '@/server/auth/session';
import { getConfig } from '@/server/config';
import { Money } from '@/domain/money/money';
import { SpecTable, Chip } from '@/components/system';
import { EquityCurve } from '@/components/admin/EquityCurve';
import { HeadroomBar } from '@/components/admin/HeadroomBar';

export const metadata: Metadata = { title: 'Account detail' };
export const dynamic = 'force-dynamic';

const fmt = (minor: bigint) => Money.fromMinor(minor).format();
const price = (e8: bigint | null) =>
  e8 === null ? '—' : (Number(e8) / 1e8).toLocaleString('en-US', { minimumFractionDigits: 2 });

function duration(seconds: number | null): string {
  if (seconds === null) return 'open';
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
  return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
}

/** A statistic with no denominator. Shown as absent, with why. */
function Absent({ reason }: { reason: string }) {
  return (
    <span className="no-caps text-fg-subtle" title={reason}>
      —
    </span>
  );
}

function StatCell({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
      <p className="no-caps text-[11px] font-bold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className="tnum mt-1 font-bold">{value}</p>
    </div>
  );
}

export default async function AdminAccountDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  if (user.role !== 'OWNER' && user.role !== 'FINANCE' && user.role !== 'RISK') {
    redirect('/dashboard');
  }

  const { id } = await params;
  const detail = await getAccountDetail(id);
  if (!detail) notFound();

  const config = getConfig();
  const { row, stats, economics } = detail;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10 space-y-8">
      <header>
        <Link href="/admin/accounts" className="no-caps text-sm text-accent hover:underline">
          &larr; All accounts
        </Link>
        <h1 className="mt-2 text-3xl">
          {row.tier} <span className="text-fg-muted">·</span> {row.ownerName ?? row.ownerEmail}
        </h1>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="no-caps text-sm text-fg-muted">{row.ownerEmail}</span>
          <span className="no-caps text-xs font-bold uppercase tracking-wide">
            {row.status.replace('_', ' ')}
          </span>
          {row.inCluster && <Chip status="STOP">In correlated cluster</Chip>}
        </div>
        {config.isDemo && (
          <p className="no-caps mt-3 rounded-lg border border-fg/30 bg-surface px-3 py-2 text-sm font-bold">
            Demonstration data. Fixtures, not business statistics.
          </p>
        )}
      </header>

      <section aria-labelledby="curve" className="space-y-3">
        <h2 id="curve" className="text-2xl">
          Equity and threshold
        </h2>
        <EquityCurve points={detail.equityCurve} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <p className="no-caps text-[11px] font-bold uppercase tracking-wide text-fg-subtle">
              Drawdown room
            </p>
            <div className="mt-1">
              <HeadroomBar headroom={row.drawdown} label="Drawdown headroom" />
            </div>
          </div>
          <div className="rounded-lg border border-border bg-surface px-3 py-2.5">
            <p className="no-caps text-[11px] font-bold uppercase tracking-wide text-fg-subtle">
              Daily loss room
            </p>
            <div className="mt-1">
              <HeadroomBar headroom={row.dailyLoss} label="Daily loss headroom" />
            </div>
          </div>
          <StatCell label="Equity" value={fmt(row.equityMinor)} />
          <StatCell label="Peak equity" value={fmt(row.highWaterMinor)} />
        </div>
      </section>

      <section aria-labelledby="economics" className="space-y-3">
        <h2 id="economics" className="text-2xl">
          What this account is worth
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <StatCell label="Account fee" value={fmt(economics.initialPaidMinor)} />
          <StatCell label="Reset spend" value={fmt(economics.resetSpendMinor)} />
          <StatCell label="Total paid in" value={fmt(economics.totalPaidMinor)} />
          <StatCell label="Cash paid out" value={fmt(economics.cashPaidOutMinor)} />
          <StatCell
            label="Net to firm"
            value={
              <span className={economics.netToFirmMinor < 0n ? '' : 'text-accent'}>
                {fmt(economics.netToFirmMinor)}
              </span>
            }
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <StatCell
            label="Worst case remaining"
            value={
              row.remainingLifetimeCapMinor === null ? (
                <Absent reason="Uncapped policy approved: unbounded" />
              ) : (
                fmt(row.remainingLifetimeCapMinor)
              )
            }
          />
          <StatCell
            label="Exposure ratio"
            value={
              row.exposureRatio === null ? (
                <Absent reason="Nothing paid, or no cap set" />
              ) : (
                `${row.exposureRatio.toFixed(1)}x`
              )
            }
          />
        </div>
      </section>

      <section aria-labelledby="stats" className="space-y-3">
        <h2 id="stats" className="text-2xl">
          Trading statistics
        </h2>
        {stats.trades === 0 ? (
          <p className="no-caps text-sm text-fg-subtle">
            This account has no closed trades, so it has no statistics — not a 0% win rate.
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCell
                label="Win rate"
                value={
                  stats.winRate.value === null ? (
                    <Absent reason="No decided trades" />
                  ) : (
                    `${stats.wins}W - ${stats.losses}L`
                  )
                }
              />
              <StatCell
                label="Profit factor"
                value={
                  stats.profitFactor === null ? (
                    <Absent reason="No losing trades, so there is no ratio" />
                  ) : (
                    stats.profitFactor.toFixed(2)
                  )
                }
              />
              <StatCell
                label="Expectancy"
                value={stats.expectancyMinor === null ? <Absent reason="No trades" /> : fmt(stats.expectancyMinor)}
              />
              <StatCell
                label="Average win"
                value={stats.averageWinMinor === null ? <Absent reason="No winning trades" /> : fmt(stats.averageWinMinor)}
              />
              <StatCell
                label="Average loss"
                value={stats.averageLossMinor === null ? <Absent reason="No losing trades" /> : fmt(stats.averageLossMinor)}
              />
              <StatCell
                label="Largest win"
                value={stats.largestWinMinor === null ? <Absent reason="No winning trades" /> : fmt(stats.largestWinMinor)}
              />
              <StatCell
                label="Largest loss"
                value={stats.largestLossMinor === null ? <Absent reason="No losing trades" /> : fmt(stats.largestLossMinor)}
              />
              <StatCell
                label="Average hold"
                value={stats.averageHoldSeconds === null ? <Absent reason="No trades" /> : duration(stats.averageHoldSeconds)}
              />
              <StatCell label="Commissions" value={fmt(stats.commissionMinor)} />
              <StatCell
                label="Net P&L"
                value={
                  <span className={stats.netPnlMinor < 0n ? '' : 'text-accent'}>
                    {fmt(stats.netPnlMinor)}
                  </span>
                }
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-2">
              <div>
                <h3 className="text-sm mb-2">Long vs short</h3>
                <SpecTable
                  caption="Performance split by direction"
                  columns={[
                    { key: 'side', label: 'Side' },
                    { key: 'trades', label: 'Trades', numeric: true },
                    { key: 'wr', label: 'W-L', numeric: true },
                    { key: 'net', label: 'Net', numeric: true },
                  ]}
                  rows={[
                    { side: 'Long', s: detail.bySide.long },
                    { side: 'Short', s: detail.bySide.short },
                  ].map(({ side, s }) => ({
                    side,
                    trades: s.trades,
                    wr: s.trades === 0 ? '—' : `${s.wins}-${s.losses}`,
                    net: fmt(s.netPnlMinor),
                  }))}
                />
              </div>

              <div>
                <h3 className="text-sm mb-2">By symbol</h3>
                <SpecTable
                  caption="Performance by instrument"
                  columns={[
                    { key: 'symbol', label: 'Symbol' },
                    { key: 'trades', label: 'Trades', numeric: true },
                    { key: 'wr', label: 'W-L', numeric: true },
                    { key: 'net', label: 'Net', numeric: true },
                  ]}
                  rows={detail.bySymbol.map(({ symbol, stats: s }) => ({
                    symbol: <span className="font-mono">{symbol}</span>,
                    trades: s.trades,
                    wr: `${s.wins}-${s.losses}`,
                    net: fmt(s.netPnlMinor),
                  }))}
                />
              </div>

              <div>
                <h3 className="text-sm mb-2">Hold time</h3>
                <SpecTable
                  caption="Distribution of how long positions were held"
                  columns={[
                    { key: 'label', label: 'Duration' },
                    { key: 'count', label: 'Trades', numeric: true },
                  ]}
                  rows={detail.durations.map((d) => ({ label: d.label, count: d.count }))}
                />
              </div>

              <div>
                <h3 className="text-sm mb-2">By hour (ET)</h3>
                <SpecTable
                  caption="Win rate by hour of the session, New York time"
                  columns={[
                    { key: 'hour', label: 'Hour' },
                    { key: 'trades', label: 'Trades', numeric: true },
                    { key: 'wr', label: 'W-L', numeric: true },
                  ]}
                  rows={detail.byHour.map(({ hour, stats: s }) => ({
                    hour: `${String(hour).padStart(2, '0')}:00`,
                    trades: s.trades,
                    wr: `${s.wins}-${s.losses}`,
                  }))}
                />
              </div>
            </div>
          </>
        )}
      </section>

      <section aria-labelledby="trades" className="space-y-3">
        <h2 id="trades" className="text-2xl">
          Trades
        </h2>
        {detail.trades.length === 0 ? (
          <p className="no-caps text-sm text-fg-subtle">No trades recorded for this account.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-border">
            <table className="w-full min-w-[64rem] text-sm">
              <caption className="sr-only">Every trade on this account</caption>
              <thead className="bg-surface-raised">
                <tr className="border-b border-border">
                  {['Opened', 'Symbol', 'Side', 'Qty', 'Entry', 'Exit', 'P&L', '%', 'Held', 'Result'].map(
                    (heading) => (
                      <th
                        key={heading}
                        scope="col"
                        className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold tracking-wide text-fg-muted"
                      >
                        {heading}
                      </th>
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {detail.trades.map((trade) => (
                  <tr key={trade.id} className="border-t border-border">
                    <td className="px-3 py-2 tnum whitespace-nowrap text-xs">
                      {trade.openedAt.toISOString().slice(0, 16).replace('T', ' ')}
                    </td>
                    <td className="px-3 py-2 font-mono">{trade.symbol}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span aria-hidden="true">{trade.side === 'LONG' ? '↑' : '↓'}</span>{' '}
                      <span className="no-caps text-xs font-bold">{trade.side}</span>
                    </td>
                    <td className="px-3 py-2 tnum">{trade.quantity}</td>
                    <td className="px-3 py-2 tnum">{price(trade.entryPriceE8)}</td>
                    <td className="px-3 py-2 tnum">{price(trade.exitPriceE8)}</td>
                    <td className="px-3 py-2 tnum whitespace-nowrap">
                      {trade.status === 'OPEN' ? (
                        <Absent reason="Position is still open" />
                      ) : (
                        <span className={trade.realisedPnlMinor < 0n ? 'font-bold' : 'text-accent font-bold'}>
                          {fmt(trade.realisedPnlMinor)}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 tnum">
                      {trade.returnPercent === null ? '—' : `${trade.returnPercent.toFixed(2)}%`}
                    </td>
                    <td className="px-3 py-2 tnum whitespace-nowrap">{duration(trade.holdSeconds)}</td>
                    <td className="px-3 py-2">
                      <span className="no-caps text-xs font-bold uppercase tracking-wide">
                        {trade.status === 'OPEN'
                          ? 'Open'
                          : trade.realisedPnlMinor > 0n
                            ? 'Win'
                            : trade.realisedPnlMinor < 0n
                              ? 'Loss'
                              : 'Scratch'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="payouts" className="space-y-3">
        <h2 id="payouts" className="text-2xl">
          Payout history
        </h2>
        {detail.payouts.length === 0 ? (
          <p className="no-caps text-sm text-fg-subtle">No payout requests on this account.</p>
        ) : (
          <SpecTable
            caption="Payout requests and their outcome"
            columns={[
              { key: 'requested', label: 'Requested' },
              { key: 'gross', label: 'Gross', numeric: true },
              { key: 'cash', label: 'Cash', numeric: true },
              { key: 'state', label: 'State' },
              { key: 'paid', label: 'Paid' },
            ]}
            rows={detail.payouts.map((payout) => ({
              requested: payout.requestedAt.toISOString().slice(0, 10),
              gross: fmt(payout.grossMinor),
              cash: <span className="text-accent font-bold">{fmt(payout.cashMinor)}</span>,
              state: <span className="no-caps text-xs font-bold uppercase">{payout.state}</span>,
              paid: payout.paidAt ? payout.paidAt.toISOString().slice(0, 10) : '—',
            }))}
          />
        )}
      </section>

      <section aria-labelledby="risk" className="space-y-3">
        <h2 id="risk" className="text-2xl">
          Risk events
        </h2>
        {detail.riskEvents.length === 0 && detail.resets.length === 0 ? (
          <p className="no-caps text-sm text-fg-subtle">Nothing has happened on this account yet.</p>
        ) : (
          <ol className="space-y-2">
            {detail.riskEvents.map((event) => (
              <li key={event.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="no-caps text-xs font-bold uppercase tracking-wide">
                    {event.eventType.replace(/_/g, ' ')}
                  </span>
                  <span className="no-caps tnum text-xs text-fg-subtle">
                    {event.occurredAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                  {event.severity === 'CRITICAL' && <Chip status="STOP">Critical</Chip>}
                </div>
                <p className="no-caps mt-1 text-sm text-fg-muted leading-relaxed">{event.reason}</p>
              </li>
            ))}
            {detail.resets.map((reset) => (
              <li key={reset.id} className="rounded-lg border border-border bg-surface p-3">
                <div className="flex flex-wrap items-baseline gap-2">
                  <span className="no-caps text-xs font-bold uppercase tracking-wide">Reset purchased</span>
                  <span className="no-caps tnum text-xs text-fg-subtle">
                    {reset.createdAt.toISOString().slice(0, 16).replace('T', ' ')}
                  </span>
                </div>
                <p className="no-caps mt-1 text-sm text-fg-muted">
                  {fmt(reset.priceMinor)}. Consumed payout capacity was not restored.
                </p>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
