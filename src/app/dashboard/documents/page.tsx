import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { getCurrentUser } from '@/server/auth/session';
import { Badge, Card } from '@/components/ui';
import { Money } from '@/domain/money/money';

export const metadata: Metadata = { title: 'Documents and receipts' };
export const dynamic = 'force-dynamic';

export default async function DocumentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login?next=%2Fdashboard%2Fdocuments');

  const [acceptances, orders] = await Promise.all([
    prisma.agreementAcceptance.findMany({
      where: { userId: user.id },
      include: { document: true },
      orderBy: { signedAt: 'desc' },
    }),
    prisma.order.findMany({
      where: { userId: user.id },
      include: { items: true, payments: true },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  return (
    <div className="mx-auto max-w-4xl px-4 py-10 space-y-8">
      <header>
        <h1 className="text-2xl font-bold tracking-tight">Documents and receipts</h1>
        <p className="mt-2 text-fg-muted">
          Everything you signed, exactly as it was presented to you, plus your purchase receipts.
        </p>
      </header>

      <section aria-labelledby="signed">
        <h2 id="signed" className="text-lg font-semibold mb-3">
          What you signed
        </h2>
        {acceptances.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-fg-subtle">You have not signed anything yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {acceptances.map((acceptance) => (
              <Card key={acceptance.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-medium">{acceptance.document.title}</h3>
                    <p className="text-sm text-fg-muted mt-1">
                      Signed {new Date(acceptance.signedAt).toLocaleString('en-US')} as{' '}
                      <span className="text-fg">{acceptance.typedLegalName}</span>
                    </p>
                  </div>
                  {acceptance.document.status === 'DRAFT_PENDING_LEGAL_REVIEW' && (
                    <Badge tone="warn">Draft pending legal review</Badge>
                  )}
                </div>

                <dl className="mt-3 text-xs text-fg-subtle space-y-1">
                  <div className="flex gap-2">
                    <dt>Document version:</dt>
                    <dd className="font-mono">v{acceptance.document.version}</dd>
                  </div>
                  <div className="flex gap-2">
                    <dt>Document hash:</dt>
                    <dd className="font-mono break-all">{acceptance.documentHash}</dd>
                  </div>
                  {acceptance.quoteHash && (
                    <div className="flex gap-2">
                      <dt>Terms hash:</dt>
                      <dd className="font-mono break-all">{acceptance.quoteHash}</dd>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <dt>Signature method:</dt>
                    <dd>{acceptance.signatureMethod.replaceAll('_', ' ').toLowerCase()}</dd>
                  </div>
                </dl>

                <p className="mt-3 text-xs text-fg-subtle italic leading-relaxed">
                  &ldquo;{acceptance.consentWording}&rdquo;
                </p>

                <div className="mt-3 flex gap-3 text-sm">
                  <Link
                    href={`/legal/${acceptance.document.slug}`}
                    className="text-accent hover:underline"
                  >
                    Read the document
                  </Link>
                  <Link
                    href={`/api/documents/${acceptance.id}/download`}
                    className="text-fg-subtle hover:text-fg"
                  >
                    Download a copy
                  </Link>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="receipts">
        <h2 id="receipts" className="text-lg font-semibold mb-3">
          Receipts
        </h2>
        {orders.length === 0 ? (
          <Card className="p-5">
            <p className="text-sm text-fg-subtle">No purchases yet.</p>
          </Card>
        ) : (
          <div className="space-y-3">
            {orders.map((order) => (
              <Card key={order.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      Order {order.id.slice(-10)}
                    </p>
                    <p className="text-sm text-fg-subtle">
                      {new Date(order.createdAt).toLocaleString('en-US')}
                    </p>
                  </div>
                  <Badge tone={order.status === 'FULFILLED' ? 'accent' : 'neutral'}>
                    {order.status.replaceAll('_', ' ').toLowerCase()}
                  </Badge>
                </div>

                <dl className="mt-3 text-sm">
                  {order.items.map((item) => (
                    <div key={item.id} className="flex justify-between py-1.5 border-b border-border">
                      <dt className="text-fg-muted">{item.name}</dt>
                      <dd className="tnum">
                        {Money.fromMinor(item.lineTotalMinor).format()}
                      </dd>
                    </div>
                  ))}
                  {order.discountMinor > 0n && (
                    <div className="flex justify-between py-1.5 border-b border-border text-accent">
                      <dt>Discount applied</dt>
                      <dd className="tnum">
                        &minus;{Money.fromMinor(order.discountMinor).format()}
                      </dd>
                    </div>
                  )}
                  <div className="flex justify-between py-1.5 font-semibold">
                    <dt>Total</dt>
                    <dd className="tnum">{Money.fromMinor(order.totalMinor).format()}</dd>
                  </div>
                </dl>

                <p className="mt-2 text-xs text-fg-subtle">
                  One-time charge. Not a subscription.
                  {order.payments[0] && ` Payment status: ${order.payments[0].status.toLowerCase()}.`}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>

      <p className="text-sm text-fg-subtle">
        <Link href="/dashboard" className="text-accent hover:underline">
          Back to your dashboard
        </Link>
      </p>
    </div>
  );
}
