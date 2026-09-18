import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { ForbiddenError, UnauthorizedError, requireRole } from '@/server/auth/session';
import { getAdminOverview, getLaunchReadiness } from '@/server/views/admin-view';
import { Badge, Callout, Card, DataRow } from '@/components/ui';

export const metadata: Metadata = { title: 'Admin' };
export const dynamic = 'force-dynamic';

export default async function AdminPage() {
  try {
    await requireRole('OWNER', 'FINANCE', 'SUPPORT', 'RISK');
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login?next=%2Fadmin');
    if (error instanceof ForbiddenError) {
      return (
        <div className="mx-auto max-w-2xl px-4 py-16">
          <Callout tone="danger" title="Access denied">
            {error.message}
          </Callout>
        </div>
      );
    }
    throw error;
  }

  const [overview, readiness] = await Promise.all([getAdminOverview(), getLaunchReadiness()]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Operations</h1>
          <p className="text-sm text-fg-muted mt-1">Running in {overview.mode} mode.</p>
        </div>
        <nav className="flex flex-wrap gap-2">
          <Link
            href="/admin/payouts"
            className="rounded-lg border border-border-strong px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            Payout queue
          </Link>
          <Link
            href="/admin/economics"
            className="rounded-lg border border-border-strong px-4 py-2 text-sm hover:border-accent hover:text-accent"
          >
            Economics
          </Link>
        </nav>
      </header>

      {/* --------------------------- launch gate --------------------------- */}
      <Card className="p-5">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <h2 className="text-lg font-semibold">Launch readiness</h2>
          <Badge tone={readiness.ready ? 'accent' : 'danger'}>
            {readiness.ready
              ? 'No blockers'
              : `${readiness.blockingCount} blocker${readiness.blockingCount === 1 ? '' : 's'}`}
          </Badge>
        </div>

        {!readiness.ready && (
          <Callout tone="danger" title="Production sales are blocked">
            Real-money sales cannot be enabled while any blocking item below is open. This is
            enforced in the checkout service, not only displayed here.
          </Callout>
        )}

        <div className="mt-4 space-y-4">
          {readiness.groups.map((group) => (
            <div key={group.area}>
              <h3 className="text-sm font-semibold text-fg-muted mb-2">{group.area}</h3>
              <ul className="space-y-1.5">
                {group.blockers.map((blocker, index) => (
                  <li key={index} className="flex items-start gap-2 text-sm">
                    <span
                      aria-hidden="true"
                      className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                        blocker.blocking ? 'bg-danger' : 'bg-warn'
                      }`}
                    />
                    <span className="text-fg-muted leading-relaxed">
                      {blocker.detail}
                      {!blocker.blocking && (
                        <span className="text-fg-subtle"> (not blocking)</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </Card>

      {/* ----------------------------- alerts ------------------------------ */}
      {overview.alerts.length > 0 && (
        <section aria-labelledby="alerts">
          <h2 id="alerts" className="text-lg font-semibold mb-3">
            Alerts
          </h2>
          <div className="space-y-2">
            {overview.alerts.map((alert, index) => (
              <Callout key={index} tone={alert.severity === 'CRITICAL' ? 'danger' : 'warn'}>
                {alert.message}
                {alert.href && (
                  <>
                    {' '}
                    <Link href={alert.href} className="underline">
                      Open
                    </Link>
                  </>
                )}
              </Callout>
            ))}
          </div>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-semibold mb-1">Real cash</h2>
          <p className="text-xs text-fg-subtle mb-3">
            Fees actually collected and cash actually paid. Simulated trading results never appear
            here: a simulated gain is not revenue and a simulated loss is not a company loss.
          </p>
          <dl>
            <DataRow label="Account and add-on fees earned" value={overview.cash.feesCollected.display} emphasis />
            <DataRow label="Discounts given" value={overview.cash.discountsGiven.display} />
            <DataRow label="Payment processing fees paid" value={overview.cash.processorFees.display} />
            <DataRow
              label="Cash rewards paid to traders"
              value={overview.cash.rewardsPaid.display}
              hint="A genuine company expense, being 50% of every gross withdrawal."
            />
            <DataRow label="Refunds paid" value={overview.cash.refundsPaid.display} />
            <DataRow
              label="Rewards owed but not yet paid"
              value={overview.cash.outstandingObligations.display}
              hint="Approved payouts awaiting payment."
            />
          </dl>
        </Card>

        <Card className="p-5">
          <h2 className="font-semibold mb-3">Portfolio</h2>
          <dl>
            <DataRow label="Registered traders" value={overview.counts.users} />
            <DataRow label="Orders" value={overview.counts.orders} />
            <DataRow label="Active accounts" value={overview.counts.activeAccounts} />
            <DataRow label="Paused (daily loss)" value={overview.counts.pausedAccounts} />
            <DataRow label="Breached" value={overview.counts.breachedAccounts} />
            <DataRow
              label="Stale data"
              value={overview.counts.staleAccounts}
              hint="Payouts and new exposure are blocked on these."
            />
            <DataRow
              label="Paid but not provisioned"
              value={overview.counts.provisioningStuck}
              hint="Customers who paid and have no account yet."
            />
            <DataRow label="Payouts in flight" value={overview.counts.payoutsPending} />
            <DataRow
              label="Payouts needing reconciliation"
              value={overview.counts.payoutsNeedingReconciliation}
            />
            <DataRow label="Dead background jobs" value={overview.counts.deadJobs} />
          </dl>
        </Card>
      </div>

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Ledger integrity</h2>
        <p className="text-xs text-fg-subtle mb-3">
          Each ledger is kept separate and must balance to zero across its own accounts. A non-zero
          net means an entry was written outside the ledger service.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {overview.ledgerIntegrity.map((ledger) => (
            <div
              key={ledger.ledger}
              className="rounded-lg border border-border bg-surface-raised p-3"
            >
              <p className="text-sm font-medium">{ledger.ledger}</p>
              <p className={`text-sm tnum mt-1 ${ledger.balanced ? 'text-accent' : 'text-danger'}`}>
                {ledger.balanced ? 'Balanced' : `Out by ${ledger.net}`}
              </p>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
