import type { Metadata } from 'next';
import Link from 'next/link';
import { getFirmOverview } from '@/server/views/admin-analytics';
import { requireUser } from '@/server/auth/session';
import { redirect } from 'next/navigation';
import { getConfig } from '@/server/config';
import { Money } from '@/domain/money/money';
import { Chip, SpecTable } from '@/components/system';

export const metadata: Metadata = { title: 'Firm overview' };
export const dynamic = 'force-dynamic';

const fmt = (minor: bigint) => Money.fromMinor(minor).format();
const pct = (value: number | null) => (value === null ? '—' : `${(value * 100).toFixed(1)}%`);

/** A figure the console cannot compute, rendered as absent with its reason. */
function Empty({ reason }: { reason: string }) {
  return (
    <span className="no-caps text-fg-subtle" title={reason}>
      —
    </span>
  );
}

function Stat({
  label,
  value,
  detail,
  emphasis,
}: {
  label: string;
  value: string;
  detail?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface p-4">
      <p className="no-caps text-xs font-bold uppercase tracking-wide text-fg-subtle">{label}</p>
      <p className={`tnum mt-2 font-bold ${emphasis ? 'text-2xl text-accent' : 'text-xl'}`}>
        {value}
      </p>
      {detail && <p className="no-caps mt-1 text-xs text-fg-subtle leading-relaxed">{detail}</p>}
    </div>
  );
}

export default async function AdminAnalyticsPage() {
  const user = await requireUser();
  if (user.role !== 'OWNER' && user.role !== 'FINANCE') redirect('/dashboard');

  const config = getConfig();
  const overview = await getFirmOverview();
  const { allTime } = overview.net;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 space-y-10">
      <header>
        <h1 className="text-3xl">Firm overview</h1>
        <p className="no-caps mt-2 text-fg-muted">
          Every figure is derived from the ledgers, the trade table and the risk engine. Nothing
          here is estimated.
        </p>
        {config.isDemo && (
          <p className="no-caps mt-3 rounded-lg border border-fg/30 bg-surface px-3 py-2 text-sm font-bold">
            Demonstration data. These are fixtures chosen to exercise boundaries, not business
            statistics.
          </p>
        )}
      </header>

      <section aria-labelledby="net" className="space-y-3">
        <h2 id="net" className="text-2xl">
          Net position
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(
            [
              ['Today', overview.net.today],
              ['7 days', overview.net.sevenDays],
              ['30 days', overview.net.thirtyDays],
              ['All time', allTime],
            ] as const
          ).map(([label, net]) => (
            <Stat
              key={label}
              label={label}
              value={fmt(net.netMinor)}
              emphasis={label === 'All time'}
              detail={`Fees ${fmt(net.accountFeesMinor + net.addOnFeesMinor)} · resets ${fmt(
                net.resetFeesMinor,
              )} · cash out ${fmt(net.cashPaidMinor)}`}
            />
          ))}
        </div>
        {allTime.unreconciled && (
          <div className="rounded-xl border border-border-strong bg-surface p-4">
            <div className="flex flex-wrap items-center gap-2">
              <p className="no-caps text-sm font-bold">Ledger and orders disagree</p>
              <Chip status="UNRESOLVED" />
            </div>
            <p className="no-caps mt-2 text-sm text-fg-muted leading-relaxed">
              Paid orders total {fmt(allTime.orderRevenueMinor)}, but the revenue ledger holds{' '}
              {fmt(allTime.accountFeesMinor + allTime.addOnFeesMinor)}. The ledger is authoritative,
              so the net position above is computed from it. The gap means revenue posting has not
              run for some orders — in this environment, because seeded orders bypass the payment
              flow that posts them.
            </p>
          </div>
        )}
      </section>

      <section aria-labelledby="exposure" className="space-y-3">
        <h2 id="exposure" className="text-2xl">
          Open exposure
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat
            label="Could still owe"
            value={fmt(overview.exposure.openExposureMinor)}
            emphasis
            detail={`Remaining lifetime capacity across ${overview.exposure.liveAccounts} live accounts`}
          />
          <Stat
            label="Revenue collected"
            value={fmt(overview.exposure.cumulativeRevenueMinor)}
            detail="Cumulative, from the revenue ledger"
          />
          <Stat
            label="Uncapped accounts"
            value={String(overview.exposure.uncappedAccounts)}
            detail="Counted separately: an uncapped account contributes an unbounded amount, so it is not summed above"
          />
        </div>
      </section>

      <section aria-labelledby="liability" className="space-y-3">
        <h2 id="liability" className="text-2xl">
          Payout liability today
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Eligible accounts" value={String(overview.payoutLiability.eligibleAccounts)} />
          <Stat label="Gross if all withdrew" value={fmt(overview.payoutLiability.grossIfAllWithdrewMinor)} />
          <Stat
            label="Cash if all withdrew"
            value={fmt(overview.payoutLiability.cashIfAllWithdrewMinor)}
            emphasis
            detail="Half the gross, which is what actually leaves the business"
          />
        </div>
      </section>

      {overview.clusters.length > 0 && (
        <section aria-labelledby="clusters" className="space-y-3">
          <h2 id="clusters" className="text-2xl">
            Correlated clusters
          </h2>
          <p className="no-caps text-sm text-fg-muted">
            Accounts taking matching trades within 5 seconds. One idea multiplied across accounts is
            not a diversified book.
          </p>
          <SpecTable
            caption="Correlated account clusters and their combined exposure"
            columns={[
              { key: 'accounts', label: 'Accounts', numeric: true },
              { key: 'trades', label: 'Matched trades', numeric: true },
              { key: 'symbols', label: 'Symbols' },
              { key: 'cap', label: 'Combined remaining cap', numeric: true },
            ]}
            rows={overview.clusters.map((cluster, index) => ({
              accounts: <span key={index} className="font-bold">{cluster.accounts}</span>,
              trades: cluster.matchedTrades,
              symbols: cluster.symbols.join(', '),
              cap:
                cluster.combinedRemainingCapMinor === null ? (
                  <Empty reason="A member has an uncapped policy, so the combined figure is unbounded" />
                ) : (
                  <span className="font-bold">{fmt(cluster.combinedRemainingCapMinor)}</span>
                ),
            }))}
          />
        </section>
      )}

      <section aria-labelledby="funnel" className="space-y-3">
        <h2 id="funnel" className="text-2xl">
          Account population
        </h2>
        <SpecTable
          caption="Accounts at each stage of their life"
          columns={[
            { key: 'stage', label: 'Stage' },
            { key: 'count', label: 'Accounts', numeric: true },
            { key: 'rate', label: 'Of purchased', numeric: true },
          ]}
          rows={overview.funnel.map((stage) => {
            const purchased = overview.funnel[0]!.count;
            const base = purchased.available ? purchased.value : 0;
            return {
              stage: stage.label,
              count: stage.count.available ? (
                stage.count.value
              ) : (
                <Empty reason={stage.count.reason} />
              ),
              rate:
                stage.count.available && base > 0
                  ? pct(stage.count.value / base)
                  : <Empty reason="No purchased accounts to compare against" />,
            };
          })}
        />
      </section>

      <section aria-labelledby="cohorts" className="space-y-3">
        <h2 id="cohorts" className="text-2xl">
          By account size
        </h2>
        <div className="overflow-x-auto">
          <div className="min-w-[52rem]">
            <SpecTable
              caption="Revenue, payouts and outcomes for each account tier"
              columns={[
                { key: 'tier', label: 'Tier' },
                { key: 'units', label: 'Units', numeric: true },
                { key: 'gross', label: 'Gross revenue', numeric: true },
                { key: 'paid', label: 'Cash paid', numeric: true },
                { key: 'net', label: 'Net', numeric: true },
                { key: 'payoutRatio', label: 'Payout ratio', numeric: true },
                { key: 'blowup', label: 'Blowup rate', numeric: true },
                { key: 'lifespan', label: 'Avg days', numeric: true },
              ]}
              rows={overview.cohorts.map((cohort) => ({
                tier: <span className="font-bold tnum">{cohort.label}</span>,
                units: cohort.unitsSold,
                gross: fmt(cohort.grossRevenueMinor),
                paid: fmt(cohort.cashPaidMinor),
                net: (
                  <span className={cohort.netMinor < 0n ? 'font-bold' : 'text-accent font-bold'}>
                    {fmt(cohort.netMinor)}
                  </span>
                ),
                payoutRatio: cohort.payoutRatio === null ? <Empty reason="No revenue in this tier" /> : pct(cohort.payoutRatio),
                blowup: cohort.blowupRate === null ? <Empty reason="No accounts in this tier" /> : pct(cohort.blowupRate),
                lifespan:
                  cohort.averageLifespanDays === null ? (
                    <Empty reason="No accounts in this tier" />
                  ) : (
                    cohort.averageLifespanDays.toFixed(1)
                  ),
              }))}
            />
          </div>
        </div>
      </section>

      <section aria-labelledby="resets" className="space-y-3">
        <h2 id="resets" className="text-2xl">
          Blowups and resets
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          <Stat label="Blown accounts" value={String(overview.resets.blowups)} />
          <Stat label="Resets purchased" value={String(overview.resets.resetsPurchased)} />
          <Stat
            label="Reset rate after blowup"
            value={overview.resets.resetRate === null ? '—' : pct(overview.resets.resetRate)}
            detail={overview.resets.resetRate === null ? 'No blown accounts yet' : undefined}
          />
        </div>
      </section>

      <p className="no-caps text-sm text-fg-subtle">
        <Link href="/admin/accounts" className="text-accent hover:underline">
          Every account, with headroom &rarr;
        </Link>
      </p>
    </div>
  );
}
