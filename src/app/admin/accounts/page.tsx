import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getAccountRows } from '@/server/views/admin-analytics';
import { requireUser } from '@/server/auth/session';
import { getConfig } from '@/server/config';
import { Money } from '@/domain/money/money';
import { HeadroomBar } from '@/components/admin/HeadroomBar';
import { Chip } from '@/components/system';

export const metadata: Metadata = { title: 'Accounts' };
export const dynamic = 'force-dynamic';

const fmt = (minor: bigint) => Money.fromMinor(minor).format();

/**
 * Every simulated account, one row each.
 *
 * Ordered by how close each account is to dying rather than by age: the whole
 * point of the headroom columns is spotting those without opening anything, and
 * sorting by creation date buries them.
 */
export default async function AdminAccountsPage() {
  const user = await requireUser();
  if (user.role !== 'OWNER' && user.role !== 'FINANCE' && user.role !== 'RISK') {
    redirect('/dashboard');
  }

  const config = getConfig();
  const rows = await getAccountRows();

  const bandRank = { CRITICAL: 0, TIGHT: 1, COMFORTABLE: 2 } as const;
  const sorted = [...rows].sort(
    (a, b) => bandRank[a.drawdown.band] - bandRank[b.drawdown.band],
  );

  const totals = rows.reduce(
    (acc, row) => ({
      netPnlMinor: acc.netPnlMinor + row.stats.netPnlMinor,
      trades: acc.trades + row.stats.trades,
      wins: acc.wins + row.stats.wins,
      losses: acc.losses + row.stats.losses,
      collectedMinor: acc.collectedMinor + row.paidMinor,
      cashPaidMinor: acc.cashPaidMinor + row.cashPaidMinor,
    }),
    { netPnlMinor: 0n, trades: 0, wins: 0, losses: 0, collectedMinor: 0n, cashPaidMinor: 0n },
  );

  return (
    <div className="mx-auto max-w-[110rem] px-4 py-10 space-y-6">
      <header>
        <h1 className="text-3xl">Accounts</h1>
        <p className="no-caps mt-2 text-fg-muted">
          Sorted by drawdown headroom, so the accounts closest to breaching are first.
        </p>
        {config.isDemo && (
          <p className="no-caps mt-3 rounded-lg border border-fg/30 bg-surface px-3 py-2 text-sm font-bold">
            Demonstration data. Fixtures, not business statistics.
          </p>
        )}
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Trader net P&L',
            value: fmt(totals.netPnlMinor),
            detail: 'Simulated. Not what the firm owes.',
          },
          { label: 'Trades', value: String(totals.trades), detail: `${rows.length} accounts` },
          {
            label: 'Win / loss',
            value: `${totals.wins}W - ${totals.losses}L`,
            detail:
              totals.wins + totals.losses === 0
                ? 'No decided trades yet'
                : `${((totals.wins / (totals.wins + totals.losses)) * 100).toFixed(0)}% win rate`,
          },
          {
            label: 'Firm net',
            value: fmt(totals.collectedMinor - totals.cashPaidMinor),
            detail: `Collected ${fmt(totals.collectedMinor)} · paid out ${fmt(totals.cashPaidMinor)}`,
          },
        ].map((card) => (
          <div key={card.label} className="rounded-xl border border-border bg-surface p-4">
            <p className="no-caps text-xs font-bold uppercase tracking-wide text-fg-subtle">
              {card.label}
            </p>
            <p className="tnum mt-2 text-xl font-bold">{card.value}</p>
            <p className="no-caps mt-1 text-xs text-fg-subtle">{card.detail}</p>
          </div>
        ))}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full min-w-[86rem] text-sm">
          <caption className="sr-only">
            Every simulated account with its headroom, trading statistics and exposure
          </caption>
          <thead className="sticky top-0 bg-surface-raised">
            <tr className="border-b border-border">
              {[
                'Owner',
                'Tier',
                'Status',
                'Equity',
                'Drawdown room',
                'Daily loss room',
                'Positions',
                'Trades',
                'Win rate',
                'Net P&L',
                'Payouts',
                'Cash paid',
                'Cap left',
                'Ratio',
                'Days',
              ].map((heading) => (
                <th
                  key={heading}
                  scope="col"
                  className="whitespace-nowrap px-3 py-2.5 text-left text-xs font-bold tracking-wide text-fg-muted"
                >
                  {heading.toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => (
              <tr key={row.id} className="border-t border-border align-top">
                <td className="px-3 py-3">
                  <Link
                    href={`/admin/accounts/${row.id}`}
                    className="no-caps block font-medium text-accent hover:underline"
                  >
                    {row.ownerName ?? row.ownerEmail}
                  </Link>
                  <span className="no-caps block text-xs text-fg-subtle">{row.ownerEmail}</span>
                  {row.inCluster && (
                    <span className="mt-1 inline-block">
                      <Chip status="STOP">In cluster</Chip>
                    </span>
                  )}
                </td>
                <td className="px-3 py-3 tnum whitespace-nowrap">{row.tier}</td>
                <td className="px-3 py-3">
                  <span className="no-caps text-xs font-bold uppercase tracking-wide">
                    {row.status.replace('_', ' ')}
                  </span>
                </td>
                <td className="px-3 py-3 tnum whitespace-nowrap">{fmt(row.equityMinor)}</td>
                <td className="px-3 py-3">
                  <HeadroomBar headroom={row.drawdown} label="Drawdown headroom" />
                </td>
                <td className="px-3 py-3">
                  <HeadroomBar headroom={row.dailyLoss} label="Daily loss headroom" />
                </td>
                <td className="px-3 py-3 tnum whitespace-nowrap">
                  {row.openMicroEquivalents} / {row.capMicroEquivalents}
                </td>
                <td className="px-3 py-3 tnum">{row.stats.trades}</td>
                <td className="px-3 py-3 tnum whitespace-nowrap">
                  {row.stats.winRate.value === null ? (
                    <span className="text-fg-subtle" title="No decided trades yet">
                      —
                    </span>
                  ) : (
                    `${row.stats.wins}W - ${row.stats.losses}L`
                  )}
                </td>
                <td className="px-3 py-3 tnum whitespace-nowrap">
                  <span className={row.stats.netPnlMinor < 0n ? 'font-bold' : 'text-accent font-bold'}>
                    {fmt(row.stats.netPnlMinor)}
                  </span>
                </td>
                <td className="px-3 py-3 tnum">{row.payoutCount}</td>
                <td className="px-3 py-3 tnum whitespace-nowrap">{fmt(row.cashPaidMinor)}</td>
                <td className="px-3 py-3 tnum whitespace-nowrap">
                  {row.remainingLifetimeCapMinor === null ? (
                    <span className="text-fg-subtle" title="Uncapped policy approved: unbounded">
                      Uncapped
                    </span>
                  ) : (
                    fmt(row.remainingLifetimeCapMinor)
                  )}
                </td>
                <td className="px-3 py-3 tnum whitespace-nowrap">
                  {row.exposureRatio === null ? (
                    <span className="text-fg-subtle" title="Nothing paid, or no cap set">
                      —
                    </span>
                  ) : (
                    `${row.exposureRatio.toFixed(1)}x`
                  )}
                </td>
                <td className="px-3 py-3 tnum">{row.daysAlive}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="no-caps text-sm text-fg-subtle">
        <Link href="/admin/analytics" className="text-accent hover:underline">
          &larr; Firm overview
        </Link>
      </p>
    </div>
  );
}
