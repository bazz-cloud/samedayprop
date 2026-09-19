import { randomUUID } from 'node:crypto';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getCurrentUser } from '@/server/auth/session';
import { createQuote, requiredDocuments } from '@/server/services/checkout-service';
import { couponPrice, getPlan, isPlanKey } from '@/domain/catalog/plans';
import {
  ADDONS,
  applyRiskDeltas,
  isAddOnKey,
  riskDeltasFor,
  type AddOnKey,
} from '@/domain/catalog/addons';
import { getConfig } from '@/server/config';
import { DEFAULT_PLATFORM, PLATFORMS } from '@/domain/catalog/platforms';
import { DEFAULT_COUPON } from '@/domain/pricing/coupon';
import { getPlanViews } from '@/server/views/catalog-view';
import { CheckoutForm, type CheckoutDocument } from '@/components/CheckoutForm';
import { CheckoutSteps } from '@/components/CheckoutSteps';
import { CheckoutItem } from '@/components/CheckoutItem';
import { CheckoutSummary, NextSteps, type SummaryLine } from '@/components/CheckoutSummary';
import { CheckoutUpsell, type UpsellOption } from '@/components/CheckoutUpsell';
import { Callout } from '@/components/ui';
import { serialiseMoney } from '@/server/money-mapper';

export const metadata: Metadata = { title: 'Checkout' };

/**
 * Checkout.
 *
 * Laid out the way a checkout is laid out, because this is the page where a
 * page that looks like paperwork costs money: the item on the left with the
 * figures that define it, the receipt on the right where it stays in view, the
 * promo field beside the total it changes, and one button that says the amount
 * it is about to charge.
 *
 * What is NOT compressed: the agreement bundle, the enforceability caveat, the
 * simulated-account warning and the production blockers. Those are the reasons
 * this checkout is honest, and they are the first things a redesign deletes.
 *
 * The discount is NOT applied automatically. Every page that sells an account
 * shows the list price struck through in green beside the coupon price, with
 * the code itself in a banner at the top of every page, so arriving here and
 * typing it is a deliberate act rather than a surprise. Whatever is typed is
 * re-validated server-side against live usage before it can move a number.
 */
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
  // Typed in, never applied for them. The site advertises the code beside every
  // struck-through price; entering it here is the customer taking the offer.
  const requestedCoupon = typeof params.coupon === 'string' ? params.coupon.trim() : '';
  const couponCode = requestedCoupon.length > 0 ? requestedCoupon : null;

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

  const couponApplied = !quote.discountTotal.isZero();
  const selection: (readonly [string, string])[] = [
    ['plan', planKey],
    ...addOnKeys.map((key) => ['addon', key] as const),
  ];
  const removeParams = new URLSearchParams(
    selection.map(([name, value]) => [name, value] as [string, string]),
  );

  const plan = getPlanViews().find((view) => view.key === planKey)!;
  const planLine = quote.lines.find((line) => line.kind === 'ACCOUNT_PLAN');

  const summaryLines: SummaryLine[] = quote.lines.map((line) => ({
    key: line.itemKey,
    name: line.name,
    isPlan: line.kind === 'ACCOUNT_PLAN',
    subtotal: serialiseMoney(line.lineSubtotal).display,
    total: serialiseMoney(line.lineTotal).display,
  }));

  const blockedInProduction = quote.productionBlockers.length > 0;

  // The upgrade rows, priced for THIS plan and shown as the before-and-after of
  // the limit each one changes. The link re-quotes on the server with the key
  // added or removed, carrying any typed coupon through, so the browser never
  // computes a price.
  const basePlan = getPlan(planKey);
  const hrefWith = (extra: AddOnKey) => {
    const params = new URLSearchParams([['plan', planKey]]);
    for (const key of addOnKeys) if (key !== extra) params.append('addon', key);
    if (!addOnKeys.includes(extra)) params.append('addon', extra);
    if (requestedCoupon.length > 0) params.set('coupon', requestedCoupon);
    return `/checkout?${params.toString()}`;
  };

  // Every add-on, selected or not, so the row can be ticked and unticked in
  // place rather than appearing and disappearing from the page.
  const upsellOptions: UpsellOption[] = ADDONS.map((addon) => {
    const selected = addOnKeys.includes(addon.key);
    const list = addon.listPrice.value;
    const after = applyRiskDeltas(
      {
        dailyLossLimit: basePlan.dailyLossLimit.value,
        ceilingMinis: basePlan.positionCeiling.value.minis,
        ceilingMicros: basePlan.positionCeiling.value.micros,
      },
      riskDeltasFor([addon.key]),
    );
    const isLossUplift = addon.effect.kind === 'daily-loss-uplift';
    return {
      key: addon.key,
      name: addon.name,
      limitation: addon.limitation,
      listPrice: couponApplied ? serialiseMoney(list).display : null,
      price: couponApplied
        ? serialiseMoney(couponPrice(list, quote.couponPercentOff ?? 0n)).display
        : serialiseMoney(list).display,
      before: isLossUplift
        ? basePlan.dailyLossLimit.value.format()
        : `${basePlan.positionCeiling.value.minis} minis`,
      after: isLossUplift ? after.dailyLossLimit.format() : `${after.ceilingMinis} minis`,
      selected,
      toggleHref: hrefWith(addon.key),
      icon: isLossUplift ? ('gauge' as const) : ('size' as const),
    };
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 pb-28 sm:py-10 lg:pb-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl">Checkout</h1>
          <p className="no-caps mt-1.5 flex items-center gap-2 text-sm text-fg-muted">
            <span aria-hidden="true" className="text-accent">
              &#9679;
            </span>
            Nothing is charged until you sign.
          </p>
        </div>
        <Link
          href="/accounts"
          className="no-caps text-sm text-fg-subtle hover:text-accent transition-colors"
        >
          &larr; Back to accounts
        </Link>
      </div>

      <div className="mt-5">
        <CheckoutSteps current={2} />
      </div>

      <div className="mt-7 grid gap-6 lg:grid-cols-12 lg:gap-8">
        <div className="lg:col-span-7 space-y-6">
          <section aria-labelledby="item-heading" className="space-y-3">
            <h2 id="item-heading" className="label">
              Your account
            </h2>
            {planLine && (
              <CheckoutItem
                label={plan.label}
                name={planLine.name}
                listPrice={
                  planLine.lineDiscount.isZero()
                    ? null
                    : serialiseMoney(planLine.lineSubtotal).display
                }
                price={serialiseMoney(planLine.lineTotal).display}
                changeHref="/accounts"
                specs={[
                  {
                    label: 'Max position',
                    value: `${plan.positionCeiling.minis} minis / ${plan.positionCeiling.micros} micros`,
                  },
                  { label: 'Daily loss limit', value: plan.dailyLossLimit.display },
                  { label: 'Trailing drawdown', value: plan.drawdownAllowance.display },
                  { label: 'First payout at', value: plan.firstWithdrawalAt.display },
                  { label: 'Daily cash cap', value: plan.dailyCashCap.display },
                  {
                    label: 'Lifetime cash cap',
                    value: plan.lifetimeCapResolved
                      ? (plan.lifetimeCapDescription.split(' ')[0] ?? '—')
                      : 'Not decided',
                  },
                ]}
              />
            )}
          </section>

          {upsellOptions.length > 0 && (
            <section aria-labelledby="upsell-heading" className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="upsell-heading" className="label">
                  Upgrade
                </h2>
                <p className="no-caps text-xs text-fg-subtle">
                  Optional. Neither changes what you get paid.
                </p>
              </div>
              <CheckoutUpsell options={upsellOptions} />
              <p className="no-caps text-xs text-fg-subtle leading-relaxed">
                These are applied when the account is created, so they are bought here or not at
                all.
              </p>
            </section>
          )}

          <section aria-labelledby="sign-heading" className="space-y-3">
            <h2 id="sign-heading" className="label">
              Sign and pay
            </h2>
            <CheckoutForm
              quoteId={quoteId}
              idempotencyKey={randomUUID()}
              documents={checkoutDocuments}
              platforms={PLATFORMS.value.map((platform) => ({
                key: platform.key,
                name: platform.name,
                summary: platform.summary,
                note: platform.note,
                reachable: platform.reachableFromThisApp,
              }))}
              defaultPlatform={DEFAULT_PLATFORM}
              suggestedName={user.legalName ?? ''}
              totalDisplay={serialiseMoney(quote.total).display}
              isDemo={config.isDemo}
            />
          </section>
        </div>

        <aside className="lg:col-span-5">
          <div className="lg:sticky lg:top-24 space-y-4">
            <CheckoutSummary
              lines={summaryLines}
              subtotal={serialiseMoney(quote.subtotal).display}
              discount={
                quote.discountTotal.isZero() ? null : serialiseMoney(quote.discountTotal).display
              }
              taxDisplay={
                quote.taxStatus === 'NOT_CONFIGURED'
                  ? 'Not included'
                  : serialiseMoney(quote.tax).display
              }
              taxLabel={
                quote.taxStatus === 'NOT_CONFIGURED' ? 'Tax' : 'Michigan sales tax (6%)'
              }
              taxNotConfigured={quote.taxStatus === 'NOT_CONFIGURED'}
              total={serialiseMoney(quote.total).display}
              promo={{
                code: DEFAULT_COUPON.value.code,
                percentOff: Number(DEFAULT_COUPON.value.percentOff),
                applied: couponApplied,
                savingDisplay: couponApplied
                  ? serialiseMoney(quote.discountTotal).display
                  : null,
                rejection: couponRejection ?? null,
                hidden: selection,
                removeHref: `/checkout?${removeParams.toString()}`,
                defaultHref: `/checkout?${new URLSearchParams([
                  ...selection.map(([name, value]) => [name, value] as [string, string]),
                  ['coupon', DEFAULT_COUPON.value.code],
                ]).toString()}`,
              }}
            />

            <NextSteps isDemo={config.isDemo} />

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

            <p className="no-caps text-xs text-fg-subtle leading-relaxed">
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

      {/* On a phone the summary sits below the form, so the total would only be
          visible after scrolling past everything it applies to. This is the
          same number, pinned, with a jump to the part that charges it. */}
      <div className="fixed inset-x-0 bottom-0 z-30 flex items-center justify-between gap-3 border-t border-border-strong bg-surface/95 px-4 py-3 backdrop-blur lg:hidden">
        <div>
          <p className="label text-[10px] text-fg-subtle">Due today</p>
          <p className="tnum text-lg font-bold text-accent">
            {serialiseMoney(quote.total).display}
          </p>
        </div>
        <a
          href="#sign-heading"
          className="no-caps shrink-0 rounded-lg bg-accent px-5 py-2.5 font-semibold text-black"
        >
          Sign and pay
        </a>
      </div>
    </div>
  );
}
