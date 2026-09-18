import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/session';
import { createQuote, requiredDocuments } from '@/server/services/checkout-service';
import { isPlanKey } from '@/domain/catalog/plans';
import { isAddOnKey, type AddOnKey } from '@/domain/catalog/addons';
import { getConfig } from '@/server/config';
import { CheckoutForm, type CheckoutDocument } from '@/components/CheckoutForm';
import { Callout, SectionHeading } from '@/components/ui';
import { serialiseMoney } from '@/server/money-mapper';

export const metadata: Metadata = { title: 'Checkout' };

export default async function CheckoutPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const planKey = typeof params.plan === 'string' ? params.plan : 'SIM_50K';
  const rawAddons = params.addon;
  const addOnKeys = (Array.isArray(rawAddons) ? rawAddons : rawAddons ? [rawAddons] : []).filter(
    isAddOnKey,
  ) as AddOnKey[];
  const couponCode = typeof params.coupon === 'string' ? params.coupon : null;

  if (!isPlanKey(planKey)) redirect('/accounts');

  const user = await getCurrentUser();
  if (!user) {
    const next = `/checkout?plan=${planKey}${addOnKeys.map((k) => `&addon=${k}`).join('')}${
      couponCode ? `&coupon=${couponCode}` : ''
    }`;
    redirect(`/login?next=${encodeURIComponent(next)}`);
  }

  const config = getConfig();

  // The authoritative quote is created here, server-side, from the selection
  // in the URL. A tampered URL can only change WHICH plan is quoted, never what
  // it costs.
  const { quoteId, quote, couponRejection } = await createQuote({
    planKey,
    addOnKeys,
    couponCode,
    userId: user.id,
  });

  const documents = await requiredDocuments();
  const checkoutDocuments: CheckoutDocument[] = documents.map((document) => ({
    id: document.id,
    slug: document.slug,
    title: document.title,
    isDraft: document.status === 'DRAFT_PENDING_LEGAL_REVIEW',
    excerpt: document.body.slice(0, 1400),
  }));

  const blockedInProduction = quote.productionBlockers.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl font-bold tracking-tight">Complete your purchase</h1>
      <p className="mt-2 text-fg-muted">
        Review the exact terms, sign, then pay. Nothing is charged until you sign.
      </p>

      <div className="mt-8 grid gap-8 lg:grid-cols-12">
        <div className="lg:col-span-7 space-y-8">
          <section>
            <SectionHeading number={1} title="What you are buying" />
            <div className="rounded-xl border border-border bg-surface divide-y divide-border">
              {quote.lines.map((line) => (
                <div key={line.itemKey} className="flex items-baseline justify-between gap-4 p-4">
                  <div>
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-fg-subtle mt-0.5">
                      One-time charge &middot; does not renew
                    </p>
                  </div>
                  <p className="tnum shrink-0">
                    {line.lineDiscount.isZero() ? (
                      serialiseMoney(line.lineTotal).display
                    ) : (
                      <>
                        <span className="text-fg-subtle line-through mr-2">
                          {serialiseMoney(line.lineSubtotal).display}
                        </span>
                        {serialiseMoney(line.lineTotal).display}
                      </>
                    )}
                  </p>
                </div>
              ))}
            </div>
            {couponRejection && (
              <div className="mt-3">
                <Callout tone="warn">{couponRejection}</Callout>
              </div>
            )}
          </section>

          <section>
            <SectionHeading
              number={2}
              title="Sign the agreements"
              hint="Read each one, acknowledge it, then sign with your full legal name."
            />
            <CheckoutForm
              quoteId={quoteId}
              idempotencyKey={randomUUID()}
              documents={checkoutDocuments}
              suggestedName={user.legalName ?? ''}
              totalDisplay={serialiseMoney(quote.total).display}
              isDemo={config.isDemo}
            />
          </section>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24 space-y-4">
            <div className="rounded-xl border border-border bg-surface-raised p-5">
              <h2 className="font-semibold">Order total</h2>
              <dl className="mt-4 space-y-0 text-sm">
                <div className="flex justify-between py-2 border-b border-border">
                  <dt className="text-fg-muted">Subtotal</dt>
                  <dd className="tnum">{serialiseMoney(quote.subtotal).display}</dd>
                </div>
                {!quote.discountTotal.isZero() && (
                  <div className="flex justify-between py-2 border-b border-border text-accent">
                    <dt>Discount ({Number(quote.couponPercentOff)}%)</dt>
                    <dd className="tnum">&minus;{serialiseMoney(quote.discountTotal).display}</dd>
                  </div>
                )}
                <div className="flex justify-between py-2 border-b border-border">
                  <dt className="text-fg-muted">Tax</dt>
                  <dd className="tnum text-fg-subtle">
                    {quote.taxStatus === 'NOT_CONFIGURED'
                      ? 'Not included'
                      : serialiseMoney(quote.tax).display}
                  </dd>
                </div>
                <div className="flex justify-between pt-4 mt-1">
                  <dt className="font-semibold">Total due today</dt>
                  <dd className="text-2xl font-bold tnum text-accent">
                    {serialiseMoney(quote.total).display}
                  </dd>
                </div>
              </dl>
              {quote.taxStatus === 'NOT_CONFIGURED' && (
                <p className="text-xs text-fg-subtle mt-3">
                  Tax treatment has not been configured, so this total excludes any tax that may
                  apply.
                </p>
              )}
            </div>

            {blockedInProduction && (
              <Callout tone="warn" title="Demonstration purchase only">
                <p className="mb-2">
                  This purchase cannot be made with real money yet, for these reasons:
                </p>
                <ul className="list-disc pl-5 space-y-1">
                  {quote.productionBlockers.map((blocker) => (
                    <li key={blocker.code}>{blocker.detail}</li>
                  ))}
                </ul>
              </Callout>
            )}

            <p className="text-xs text-fg-subtle leading-relaxed">
              Your signature is bound to this exact price and rule set. If either changes before you
              pay, we will ask you to review the update rather than charging you different terms.
              Read the{' '}
              <Link href="/rules" className="text-accent hover:underline">
                full rules
              </Link>{' '}
              at any time.
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
