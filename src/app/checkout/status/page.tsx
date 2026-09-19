import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { prisma } from '@/server/db';
import { getCurrentUser } from '@/server/auth/session';
import { traderFacingStatus, type ProvisioningState } from '@/domain/provisioning/state-machine';
import { Badge, Callout, Card } from '@/components/ui';
import { Money } from '@/domain/money/money';

export const metadata: Metadata = { title: 'Order status' };

/** Poll while provisioning is still in flight, so the page reflects reality. */
export const dynamic = 'force-dynamic';

export default async function CheckoutStatusPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const orderId = typeof params.order === 'string' ? params.order : null;
  if (!orderId) redirect('/dashboard');

  const user = await getCurrentUser();
  if (!user) redirect('/login');

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      payments: true,
      provisioningJobs: true,
      tradingAccounts: true,
      planVersion: true,
    },
  });

  if (!order) notFound();
  // Object-level authorisation: an order id in the URL is not authority to see it.
  if (order.userId !== user.id) notFound();

  const job = order.provisioningJobs[0];
  const account = order.tradingAccounts[0];
  const payment = order.payments[0];
  const state = (job?.state ?? 'payment_pending') as ProvisioningState;
  const status = traderFacingStatus(state);

  const paymentConfirmed = payment?.status === 'SUCCEEDED';
  const paymentUnknown = payment?.status === 'UNKNOWN' || payment?.status === 'PENDING';

  const steps: { label: string; done: boolean; current: boolean; note?: string }[] = [
    {
      label: 'Agreements signed',
      done: true,
      current: false,
    },
    {
      label: 'Payment confirmed',
      done: paymentConfirmed,
      current: !paymentConfirmed,
      note: paymentUnknown
        ? 'We have not yet had a definite answer from the payment provider. We will not treat this as paid until we do.'
        : payment?.status === 'FAILED'
          ? (payment.failureReason ?? 'The payment was declined.')
          : undefined,
    },
    {
      label: 'Simulated account created',
      done: Boolean(account?.externalAccountId),
      current: paymentConfirmed && !account?.externalAccountId,
    },
    {
      label: 'Risk limits verified',
      done: state === 'risk_verified' || state === 'active',
      current: state === 'provisioned_unverified',
      note:
        state === 'provisioned_unverified'
          ? 'Your account exists. We are confirming the limits with the provider before enabling trading.'
          : undefined,
    },
    {
      label: 'Ready to trade',
      done: state === 'active',
      current: state === 'risk_verified',
    },
    {
      // Never `done`. This one is not ours to complete and we must not imply
      // it has happened: the trader signs Tradovate's market data agreement
      // inside Tradovate, on first sign-in, and an account that has not had it
      // signed will not receive market data however green the steps above look.
      label: 'Sign the market data agreement, in Tradovate',
      done: false,
      current: state === 'active',
      note:
        'Tradovate asks you to sign its non-professional market data agreement the first time ' +
        'you sign in. That agreement is between you and Tradovate. We cannot sign it for you, ' +
        'and until it is signed the account will not receive market data.',
    },
  ];

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 space-y-6">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{status.headline}</h1>
        <p className="mt-2 text-fg-muted leading-relaxed">{status.detail}</p>
      </header>

      <Card className="p-5">
        <h2 className="font-semibold mb-4">Progress</h2>
        <ol className="space-y-3">
          {steps.map((step) => (
            <li key={step.label} className="flex items-start gap-3">
              <span
                aria-hidden="true"
                className={`mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[10px] font-bold ${
                  step.done
                    ? 'border-accent bg-accent text-bg'
                    : step.current
                      ? 'border-warn text-warn'
                      : 'border-border text-fg-subtle'
                }`}
              >
                {step.done ? '✓' : step.current ? '•' : ''}
              </span>
              <div className="min-w-0">
                <p className={step.done ? 'text-fg' : step.current ? 'text-warn' : 'text-fg-subtle'}>
                  {step.label}
                  <span className="sr-only">
                    {step.done ? ' — complete' : step.current ? ' — in progress' : ' — not started'}
                  </span>
                </p>
                {step.note && (
                  <p className="text-sm text-fg-subtle mt-1 leading-relaxed">{step.note}</p>
                )}
              </div>
            </li>
          ))}
        </ol>
      </Card>

      {state === 'manual_review' && (
        <Callout tone="warn" title="Our team has been notified">
          Automatic setup did not complete. Your payment is recorded and no simulated account has
          been created. We will contact you, and you are entitled to support or a remedy under the
          published refund policy.
        </Callout>
      )}

      {state === 'provisioning_failed_retryable' && (
        <Callout tone="warn" title="Retrying automatically">
          Setup did not complete on the first attempt. We are retrying. Your payment is safe and no
          account has been created yet.
        </Callout>
      )}

      <Card className="p-5">
        <h2 className="font-semibold mb-3">Your order</h2>
        <dl className="text-sm space-y-0">
          {order.items.map((item) => (
            <div key={item.id} className="flex justify-between py-2 border-b border-border">
              <dt className="text-fg-muted">{item.name}</dt>
              <dd className="tnum">{Money.fromMinor(item.lineTotalMinor).format()}</dd>
            </div>
          ))}
          <div className="flex justify-between py-2 border-b border-border">
            <dt className="text-fg-muted">Total paid</dt>
            <dd className="tnum font-semibold">{Money.fromMinor(order.totalMinor).format()}</dd>
          </div>
          <div className="flex justify-between py-2">
            <dt className="text-fg-muted">Payment status</dt>
            <dd>
              <Badge
                tone={
                  paymentConfirmed ? 'accent' : payment?.status === 'FAILED' ? 'danger' : 'warn'
                }
              >
                {payment?.status ?? 'PENDING'}
              </Badge>
            </dd>
          </div>
        </dl>
        <p className="text-xs text-fg-subtle mt-3">
          Order reference <span className="font-mono">{order.id}</span>
        </p>
      </Card>

      <div className="flex flex-wrap gap-3">
        <Link
          href="/dashboard"
          className="rounded-lg bg-accent px-5 py-2.5 font-semibold text-bg hover:bg-accent-strong"
        >
          Go to your dashboard
        </Link>
        <Link
          href="/dashboard/documents"
          className="rounded-lg border border-border-strong px-5 py-2.5 font-medium hover:border-accent hover:text-accent"
        >
          Download what you signed
        </Link>
      </div>

      {state !== 'active' && (
        <p className="text-xs text-fg-subtle">
          This page does not refresh itself. Reload it to see the latest status, or check your
          dashboard.
        </p>
      )}
    </div>
  );
}
