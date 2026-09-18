import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { ForbiddenError, UnauthorizedError, requireRole } from '@/server/auth/session';
import { Badge, Callout, Card } from '@/components/ui';
import { Money } from '@/domain/money/money';

export const metadata: Metadata = { title: 'Payout queue' };
export const dynamic = 'force-dynamic';

const OPEN_STATES = [
  'requested',
  'reserved',
  'validating',
  'approved',
  'submitted',
  'needs_reconciliation',
  'failed',
];

function stateTone(state: string) {
  if (state === 'paid') return 'accent' as const;
  if (state === 'needs_reconciliation' || state === 'failed') return 'danger' as const;
  if (state === 'submitted' || state === 'approved') return 'warn' as const;
  return 'neutral' as const;
}

export default async function AdminPayoutsPage() {
  try {
    await requireRole('OWNER', 'FINANCE');
  } catch (error) {
    if (error instanceof UnauthorizedError) redirect('/login?next=%2Fadmin%2Fpayouts');
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

  const [open, recent, reservations] = await Promise.all([
    prisma.payoutRequest.findMany({
      where: { state: { in: OPEN_STATES } },
      include: { user: { select: { email: true } }, tradingAccount: true, transitions: { orderBy: { createdAt: 'desc' }, take: 3 } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.payoutRequest.findMany({
      where: { state: { in: ['paid', 'rejected', 'canceled'] } },
      include: { user: { select: { email: true } } },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    }),
    prisma.payoutReservation.groupBy({
      by: ['status'],
      _sum: { cashAmountMinor: true },
      _count: true,
    }),
  ]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <header>
        <Link href="/admin" className="text-sm text-accent hover:underline">
          &larr; Operations
        </Link>
        <h1 className="text-2xl font-bold tracking-tight mt-2">Payout queue</h1>
      </header>

      <div className="grid gap-4 sm:grid-cols-3">
        {reservations.map((group) => (
          <Card key={group.status} className="p-4">
            <p className="text-xs text-fg-subtle uppercase tracking-wide">
              {group.status.toLowerCase()} reservations
            </p>
            <p className="text-xl font-bold tnum mt-1">
              {Money.fromMinor(group._sum.cashAmountMinor ?? 0n).format()}
            </p>
            <p className="text-xs text-fg-subtle">{group._count} request(s)</p>
          </Card>
        ))}
      </div>

      <section aria-labelledby="open">
        <h2 id="open" className="text-lg font-semibold mb-3">
          Open requests
        </h2>
        {open.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-fg-subtle">Nothing in the queue.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {open.map((request) => (
              <Card key={request.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-sm">{request.id.slice(-10)}</span>
                      <Badge tone={stateTone(request.state)}>
                        {request.state.replaceAll('_', ' ')}
                      </Badge>
                      {request.outcomeUnknown && <Badge tone="danger">outcome unknown</Badge>}
                    </div>
                    <p className="text-sm text-fg-muted mt-1">{request.user.email}</p>
                  </div>
                  <div className="text-right">
                    <p className="tnum">
                      {Money.fromMinor(request.grossMinor).format()} gross
                    </p>
                    <p className="tnum text-accent font-semibold">
                      {Money.fromMinor(request.cashMinor).format()} cash
                    </p>
                  </div>
                </div>

                <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Session:</dt>
                    <dd>{request.sessionDate}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Requested:</dt>
                    <dd>{new Date(request.createdAt).toLocaleString('en-US')}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Balance before:</dt>
                    <dd className="tnum">
                      {Money.fromMinor(request.balanceBeforeMinor).format()}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Balance after:</dt>
                    <dd className="tnum">
                      {Money.fromMinor(request.balanceAfterMinor).format()}
                    </dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Policy:</dt>
                    <dd className="font-mono">{request.policyVersion}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt className="text-fg-subtle">Account data:</dt>
                    <dd className={request.tradingAccount.dataStale ? 'text-warn' : ''}>
                      {request.tradingAccount.dataStale ? 'stale' : 'current'}
                    </dd>
                  </div>
                </dl>

                {(request.reviewReason || request.reconciliationNote) && (
                  <div className="mt-3">
                    <Callout tone={request.outcomeUnknown ? 'danger' : 'warn'}>
                      {request.reconciliationNote ?? request.reviewReason}
                    </Callout>
                  </div>
                )}

                {request.state === 'needs_reconciliation' && (
                  <p className="mt-3 text-xs text-fg-subtle leading-relaxed">
                    The simulated deduction stays applied and the capacity stays reserved. Do not
                    reverse either until an authoritative provider lookup confirms whether cash was
                    sent — reversing on an unknown outcome could let the same profit be withdrawn
                    twice.
                  </p>
                )}

                {request.transitions.length > 0 && (
                  <details className="mt-3">
                    <summary className="text-sm text-accent cursor-pointer">
                      Recent transitions
                    </summary>
                    <ul className="mt-2 space-y-1 text-xs text-fg-muted">
                      {request.transitions.map((transition) => (
                        <li key={transition.id}>
                          <span className="font-mono">
                            {transition.fromState} &rarr; {transition.toState}
                          </span>{' '}
                          &middot; {transition.actor} &middot; {transition.reason}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="recent">
        <h2 id="recent" className="text-lg font-semibold mb-3">
          Recently closed
        </h2>
        {recent.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-fg-subtle">Nothing closed yet.</p>
          </Card>
        ) : (
          <Card className="overflow-x-auto">
            <table className="w-full text-sm min-w-[36rem]">
              <caption className="sr-only">Recently closed payout requests</caption>
              <thead>
                <tr className="border-b border-border text-left text-fg-subtle">
                  <th scope="col" className="p-3 font-medium">Request</th>
                  <th scope="col" className="p-3 font-medium">Customer</th>
                  <th scope="col" className="p-3 font-medium text-right">Gross</th>
                  <th scope="col" className="p-3 font-medium text-right">Cash</th>
                  <th scope="col" className="p-3 font-medium">State</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((request) => (
                  <tr key={request.id} className="border-b border-border last:border-0">
                    <td className="p-3 font-mono text-xs">{request.id.slice(-10)}</td>
                    <td className="p-3 text-fg-muted">{request.user.email}</td>
                    <td className="p-3 tnum text-right">
                      {Money.fromMinor(request.grossMinor).format()}
                    </td>
                    <td className="p-3 tnum text-right text-accent">
                      {Money.fromMinor(request.cashMinor).format()}
                    </td>
                    <td className="p-3">
                      <Badge tone={stateTone(request.state)}>{request.state}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
      </section>
    </div>
  );
}
