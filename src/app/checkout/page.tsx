import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/session';
import { createQuote, requiredDocuments } from '@/server/services/checkout-service';
import { getPlan, isPlanKey } from '@/domain/catalog/plans';
import { isAddOnKey, type AddOnKey } from '@/domain/catalog/addons';
import { getConfig } from '@/server/config';
import { DEFAULT_COUPON } from '@/domain/pricing/coupon';
import { CheckoutForm, type CheckoutDocument } from '@/components/CheckoutForm';
import { CheckoutSteps } from '@/components/CheckoutSteps';
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
  }));

  // Toggling the coupon re-enters this page with a different query string, so
  // the discount is re-derived server-side every time rather than trusted from
  // the browser.
  const couponApplied = !quote.discountTotal.isZero();
  const base: string[][] = [['plan', planKey], ...addOnKeys.map((key) => ['addon', key])];
  const toggleParams = new URLSearchParams(
    couponApplied ? base : [...base, ['coupon', DEFAULT_COUPON.value.code]],
  );

  const selectedPlan = getPlan(planKey);
  const planLabel = selectedPlan.label;
  const planCeiling = selectedPlan.positionCeiling.value;

  const blockedInProduction = quote.productionBlockers.length > 0;

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <h1 className="text-3xl">Complete your purchase</h1>
      <p className="no-caps mt-2 text-fg-muted">
        Nothing is charged until you sign.
      </p>
      <div className="mt-5">
        <CheckoutSteps current={2} />
      </div>

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
          </section>

          <section>
            <SectionHeading
              number={2}
              title="Agree and sign"
              hint="One PDF, one signature."
            />
            <CheckoutForm
              quoteId={quoteId}
              idempotencyKey={randomUUID()}
              documents={checkoutDocuments}
              suggestedName={user.legalName ?? ''}
              totalDisplay={serialiseMoney(quote.total).display}
              isDemo={config.isDemo}
              coupon={{
                code: DEFAULT_COUPON.value.code,
                percentOff: Number(DEFAULT_COUPON.value.percentOff),
                applied: couponApplied,
                toggleHref: `/checkout?${toggleParams.toString()}`,
                savingDisplay: couponApplied
                  ? serialiseMoney(quote.discountTotal).display
                  : null,
                rejection: couponRejection ?? null,
              }}
            />
          </section>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24 space-y-4">
            <div className="rounded-xl border border-border-strong bg-card p-5">
              <p className="label">Order summary</p>
              <p className="tnum mt-2 text-lg font-bold">{planLabel}</p>
              <p className="no-caps text-sm text-fg-subtle">
                <span className="tnum">{planCeiling.minis}</span> minis or{' '}
                <span className="tnum">{planCeiling.micros}</span> micros
              </p>

              <dl className="mt-4 text-sm">
                <div className="flex justify-between gap-4 border-b border-border py-2.5">
                  <dt className="no-caps text-fg-muted">Account fee</dt>
                  <dd className="tnum">{serialiseMoney(quote.subtotal).display}</dd>
                </div>
                {!quote.discountTotal.isZero() && (
                  <div className="flex justify-between gap-4 border-b border-border py-2.5">
                    <dt className="no-caps text-fg-muted">Code {DEFAULT_COUPON.value.code}</dt>
                    <dd className="tnum text-accent">
                      &minus;{serialiseMoney(quote.discountTotal).display}
                    </dd>
                  </div>
                )}
                {/*
                  A LINE ITEM, not a marketing claim. "No subscription" in body
                  copy is something every firm in this category says; a zero on
                  the invoice is checkable.
                */}
                <div className="flex justify-between gap-4 border-b border-border py-2.5">
                  <dt className="no-caps text-fg-muted">Recurring charges</dt>
                  <dd className="tnum">$0.00</dd>
                </div>
                <div className="flex justify-between gap-4 border-b border-border py-2.5">
                  <dt className="no-caps text-fg-muted">Tax</dt>
                  <dd className="tnum text-fg-subtle">
                    {quote.taxStatus === 'NOT_CONFIGURED'
                      ? 'Not included'
                      : serialiseMoney(quote.tax).display}
                  </dd>
                </div>
                <div className="flex items-baseline justify-between gap-4 pt-4">
                  <dt className="text-sm">Due today</dt>
                  <dd className="tnum text-[26px] font-bold text-accent">
                    {serialiseMoney(quote.total).display}
                  </dd>
                </div>
              </dl>

              {quote.taxStatus === 'NOT_CONFIGURED' && (
                <p className="no-caps text-xs text-fg-fine mt-3">
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
