'use client';

/**
 * Account configurator.
 *
 * Numbered sections on the left, a sticky summary and the selected plan's rules
 * on the right, and on mobile a fixed bottom bar so the total and the primary
 * action are always one thumb away.
 *
 * Selection uses native radio inputs and checkboxes, visually restyled. That
 * keeps arrow-key navigation inside the size group, spacebar toggling on the
 * extras, and correct screen-reader announcements — all for free, and all
 * things a div-with-onClick would silently break.
 *
 * Every figure rendered here comes from the server: the plan views are computed
 * server-side, and the totals are re-fetched from /api/quotes/preview on each
 * change. Nothing in this file does arithmetic on money.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AddOnView, PlanView } from '@/server/views/catalog-view';
import { Badge, Callout, SectionHeading } from './ui';

interface PreviewLine {
  kind: string;
  itemKey: string;
  name: string;
  lineSubtotal: { display: string };
  lineDiscount: { display: string };
  lineTotal: { display: string };
}

interface Preview {
  lines: PreviewLine[];
  subtotal: { display: string };
  discountTotal: { display: string; minor: string };
  taxableTotal: { display: string };
  tax: { display: string; minor: string };
  total: { display: string };
  taxStatus: string;
  taxDescription: string;
  couponCode: string | null;
  couponPercentOff: number | null;
  couponMessage: string | null;
  billingCadence: string;
  productionBlockers: { code: string; detail: string }[];
}

function statusLabel(status: string): string {
  switch (status) {
    case 'CONFIRMED':
      return 'Confirmed';
    case 'PROPOSED':
      return 'Proposed — not yet approved';
    case 'EXTERNAL':
      return 'Depends on a third party';
    default:
      return 'Not yet decided';
  }
}

export function AccountConfigurator({
  plans,
  addOns,
  defaultPlanKey,
  isDemo,
}: {
  plans: PlanView[];
  addOns: AddOnView[];
  defaultPlanKey: string;
  isDemo: boolean;
}) {
  const [planKey, setPlanKey] = useState(defaultPlanKey);
  const [selectedAddOns, setSelectedAddOns] = useState<string[]>([]);
  const [couponInput, setCouponInput] = useState('');
  const [appliedCoupon, setAppliedCoupon] = useState<string | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const plan = useMemo(
    () => plans.find((p) => p.key === planKey) ?? plans[0]!,
    [plans, planKey],
  );

  // Abort in-flight previews so a fast click sequence cannot land an older
  // response after a newer one.
  const abortRef = useRef<AbortController | null>(null);

  const fetchPreview = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/quotes/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, addOnKeys: selectedAddOns, couponCode: appliedCoupon }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('We could not calculate that total.');
      setPreview((await response.json()) as Preview);
    } catch (caught) {
      if ((caught as Error).name === 'AbortError') return;
      setError('We could not calculate that total. Please try again.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [planKey, selectedAddOns, appliedCoupon]);

  useEffect(() => {
    void fetchPreview();
  }, [fetchPreview]);

  const toggleAddOn = (key: string) => {
    setSelectedAddOns((current) =>
      current.includes(key) ? current.filter((k) => k !== key) : [...current, key],
    );
  };

  const checkoutHref = `/checkout?plan=${encodeURIComponent(planKey)}${selectedAddOns
    .map((k) => `&addon=${encodeURIComponent(k)}`)
    .join('')}${appliedCoupon ? `&coupon=${encodeURIComponent(appliedCoupon)}` : ''}`;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-32 lg:pb-16">
      <div className="grid gap-8 lg:grid-cols-12">
        {/* ----------------------------- left column ----------------------- */}
        <div className="lg:col-span-7 space-y-10">
          <section aria-labelledby="size-heading">
            <SectionHeading
              number={1}
              title="Choose your account size"
              hint="Larger accounts, larger limits."
            />
            <h3 id="size-heading" className="sr-only">
              Account size
            </h3>
            <fieldset>
              <legend className="sr-only">Account size</legend>
              <div className="grid gap-3 sm:grid-cols-2">
                {plans.map((option) => {
                  const selected = option.key === planKey;
                  return (
                    <label
                      key={option.key}
                      className={`relative flex flex-col gap-1 rounded-xl border p-4 cursor-pointer transition-colors ${
                        selected
                          ? 'border-accent bg-accent-dim/30 ring-1 ring-accent'
                          : 'border-border bg-surface hover:border-border-strong hover:bg-surface-raised'
                      }`}
                    >
                      <input
                        type="radio"
                        name="planKey"
                        value={option.key}
                        checked={selected}
                        onChange={() => setPlanKey(option.key)}
                        className="sr-only"
                      />
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xl font-semibold tnum">{option.label}</span>
                        {selected && (
                          <span className="text-accent text-xs font-semibold uppercase tracking-wide">
                            Selected
                          </span>
                        )}
                      </div>
                      <div className="flex items-baseline gap-2">
                        <span className="text-accent font-semibold tnum">
                          {option.couponPrice.display}
                        </span>
                        <span className="text-fg-subtle line-through text-sm tnum">
                          {option.listPrice.display}
                        </span>
                      </div>
                      {/* Limits are in the table above. Repeating them on every
                          radio is the prose-restates-the-table problem. */}
                    </label>
                  );
                })}
              </div>
            </fieldset>
            <p className="no-caps text-xs text-fg-subtle mt-3">
              Apply code <span className="font-mono text-fg-muted">{plan.couponCode}</span> in step 4.
            </p>
          </section>

          {/* The selected account's figures, immediately under the choice that
              produced them. This used to sit in the sidebar, which on a phone
              put it below the extras and the coupon — a long way from the tap
              that changed it. */}

          {/* Six figures and the first-withdrawal example. The explanations
              live on /rules — someone comparing account sizes is scanning
              numbers, and a paragraph beside each one buries them. */}
          <section
            aria-labelledby="rules-heading"
            className="rounded-xl border border-border bg-surface p-5"
          >
            <div className="flex items-baseline justify-between gap-3">
              <h2 id="rules-heading" className="text-lg font-semibold tracking-tight">
                {plan.label} at a glance
              </h2>
              <a href="/rules" className="text-sm text-accent hover:underline shrink-0">
                Full rules
              </a>
            </div>

            <div className="mt-4 rounded-lg border border-accent/30 bg-accent-dim/20 p-3">
              <p className="text-sm font-medium text-accent">First payout</p>
              <p className="text-sm text-fg-muted mt-1 leading-relaxed">
                At <span className="text-fg tnum">{plan.firstWithdrawalAt.display}</span> you can
                take <span className="text-fg tnum">{plan.firstWithdrawalGross.display}</span>{' '}
                gross &rarr;{' '}
                <span className="text-accent tnum font-semibold">
                  {plan.firstWithdrawalCash.display}
                </span>{' '}
                cash.
              </p>
              {!plan.exampleIsMinimum && (
                <p className="text-sm text-fg-muted mt-1 leading-relaxed">
                  At <span className="text-fg tnum">{plan.exampleWithdrawalAt.display}</span> the
                  same request is{' '}
                  <span className="text-fg tnum">{plan.exampleWithdrawalGross.display}</span> gross
                  &rarr;{' '}
                  <span className="text-accent tnum font-semibold">
                    {plan.exampleWithdrawalCash.display}
                  </span>{' '}
                  cash, inside this account&rsquo;s{' '}
                  <span className="text-fg tnum">{plan.dailyCashCap.display}</span> daily cash cap.
                </p>
              )}
            </div>

            <dl className="mt-4">
              {plan.keyFacts.map((fact) => (
                <div
                  key={fact.label}
                  className="flex items-baseline justify-between gap-3 py-2.5 border-b border-border last:border-0"
                >
                  <dt className="text-sm text-fg-muted">{fact.label}</dt>
                  <dd className="text-sm font-medium tnum text-right">
                    {fact.value}
                    {fact.status !== 'CONFIRMED' && (
                      <span className="block text-[11px] font-normal text-warn mt-0.5">
                        {statusLabel(fact.status)}
                      </span>
                    )}
                  </dd>
                </div>
              ))}
            </dl>

            {/* The "no evaluation / no consistency / no minimum days" line is
                cut: it is the stat grid on the home page and the legend above.
                The nominal-figure sentence stays — it is a disclosure. */}
            <p className="no-caps mt-4 text-xs text-fg-subtle leading-relaxed">
              Simulated account; the balance is a nominal figure, not cash held for you.
            </p>
          </section>

          <section aria-labelledby="platform-heading">
            <SectionHeading
              number={2}
              title="Trading platform"
              
            />
            <h3 id="platform-heading" className="sr-only">
              Platform
            </h3>
            <div className="rounded-xl border border-border bg-surface p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium">Tradovate</p>
                  <p className="text-sm text-fg-muted mt-1">
                    Included. No other platform is offered.
                  </p>
                </div>
                <Badge tone="info">Not yet verified</Badge>
              </div>
            </div>
          </section>

          <section aria-labelledby="extras-heading">
            <SectionHeading
              number={3}
              title="Optional extras"
              hint="None of these affect your rules or payouts."
            />
            <h3 id="extras-heading" className="sr-only">
              Optional extras
            </h3>
            <fieldset className="space-y-3">
              <legend className="sr-only">Optional extras</legend>
              {addOns.map((addon) => {
                const selected = selectedAddOns.includes(addon.key);
                return (
                  <label
                    key={addon.key}
                    className={`flex items-start gap-3 rounded-xl border p-4 cursor-pointer transition-colors ${
                      selected
                        ? 'border-accent bg-accent-dim/30'
                        : 'border-border bg-surface hover:border-border-strong'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={selected}
                      onChange={() => toggleAddOn(addon.key)}
                      className="mt-1 h-4 w-4 accent-[var(--color-accent)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3 flex-wrap">
                        <span className="font-medium">{addon.name}</span>
                        <span className="tnum text-sm">
                          <span className="text-accent font-semibold">
                            {addon.couponPrice.display}
                          </span>{' '}
                          <span className="text-fg-subtle line-through">
                            {addon.listPrice.display}
                          </span>
                        </span>
                      </div>
                      <p className="text-sm text-fg-muted mt-1">{addon.delivery}</p>
                      {addon.status !== 'CONFIRMED' && (
                        <span className="inline-block mt-2">
                          <Badge tone="warn">Price not final</Badge>
                        </span>
                      )}
                    </div>
                  </label>
                );
              })}
            </fieldset>
            <Callout tone="neutral">No extra changes your rules or your payouts.</Callout>
          </section>

          <section aria-labelledby="coupon-heading">
            <SectionHeading number={4} title="Discount code" hint="One code per order." />
            <h3 id="coupon-heading" className="sr-only">
              Discount code
            </h3>
            <form
              className="flex flex-wrap gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                setAppliedCoupon(couponInput.trim() ? couponInput.trim().toUpperCase() : null);
              }}
            >
              <label htmlFor="coupon" className="sr-only">
                Discount code
              </label>
              <input
                id="coupon"
                name="coupon"
                value={couponInput}
                onChange={(event) => setCouponInput(event.target.value)}
                placeholder={plan.couponCode}
                autoComplete="off"
                spellCheck={false}
                className="flex-1 min-w-[12rem] rounded-lg border border-border bg-surface px-3 py-2 font-mono uppercase placeholder:text-fg-subtle placeholder:normal-case focus:border-accent"
              />
              <button
                type="submit"
                className="rounded-lg border border-border-strong bg-surface-raised px-4 py-2 font-medium hover:border-accent hover:text-accent transition-colors"
              >
                Apply
              </button>
              {appliedCoupon && (
                <button
                  type="button"
                  onClick={() => {
                    setAppliedCoupon(null);
                    setCouponInput('');
                  }}
                  className="rounded-lg px-3 py-2 text-fg-subtle hover:text-fg"
                >
                  Remove
                </button>
              )}
            </form>
            <div aria-live="polite" className="mt-2 text-sm">
              {preview?.couponMessage && <p className="text-warn">{preview.couponMessage}</p>}
              {preview?.couponCode && (
                <p className="text-accent">
                  Code {preview.couponCode} applied: {preview.couponPercentOff}% off your account
                  and every eligible extra.
                </p>
              )}
            </div>
          </section>
        </div>

        {/* ---------------------------- right column ----------------------- */}
        <div className="lg:col-span-5">
          <div className="lg:sticky lg:top-24 space-y-6">
            <section
              aria-labelledby="summary-heading"
              className="rounded-xl border border-border bg-surface-raised p-5"
            >
              <SectionHeading number={5} title="Order summary" />
              <h3 id="summary-heading" className="sr-only">
                Order summary
              </h3>

              <div aria-live="polite" aria-busy={loading}>
                {error && <Callout tone="danger">{error}</Callout>}

                {preview && (
                  <dl className="space-y-0">
                    {preview.lines.map((line) => (
                      <div
                        key={line.itemKey}
                        className="flex items-baseline justify-between gap-3 py-2 border-b border-border text-sm"
                      >
                        <dt className="text-fg-muted min-w-0">{line.name}</dt>
                        <dd className="tnum shrink-0 text-right">
                          {line.lineDiscount.display !== '$0.00' ? (
                            <>
                              <span className="text-fg-subtle line-through mr-2">
                                {line.lineSubtotal.display}
                              </span>
                              <span>{line.lineTotal.display}</span>
                            </>
                          ) : (
                            line.lineTotal.display
                          )}
                        </dd>
                      </div>
                    ))}

                    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <dt className="text-fg-muted">Subtotal</dt>
                      <dd className="tnum">{preview.subtotal.display}</dd>
                    </div>

                    {preview.discountTotal.minor !== '0' && (
                      <div className="flex items-baseline justify-between gap-3 py-2 text-sm text-accent">
                        <dt>Discount ({preview.couponPercentOff}%)</dt>
                        <dd className="tnum">&minus;{preview.discountTotal.display}</dd>
                      </div>
                    )}

                    <div className="flex items-baseline justify-between gap-3 py-2 text-sm">
                      <dt className="text-fg-muted">
                        {preview.taxStatus === 'NOT_CONFIGURED' ? 'Tax' : 'Michigan sales tax (6%)'}
                      </dt>
                      <dd className="tnum text-fg-subtle">
                        {preview.taxStatus === 'NOT_CONFIGURED' ? 'Not included' : preview.tax.display}
                      </dd>
                    </div>

                    <div className="flex items-baseline justify-between gap-3 pt-4 mt-2 border-t border-border-strong">
                      <dt className="font-semibold">Total due today</dt>
                      <dd className="text-2xl font-bold tnum text-accent">
                        {preview.total.display}
                      </dd>
                    </div>
                  </dl>
                )}

                {!preview && loading && (
                  <p className="text-sm text-fg-subtle py-8 text-center">Calculating…</p>
                )}
              </div>

              <p className="text-xs text-fg-subtle mt-3">
                One-time charge. Nothing renews.
                {preview?.taxStatus === 'NOT_CONFIGURED' && ' Tax not configured; totals exclude any tax.'}
              </p>

              <a
                href={checkoutHref}
                className="mt-4 hidden lg:flex w-full items-center justify-center rounded-lg bg-accent px-4 py-3 font-semibold text-bg hover:bg-accent-strong transition-colors"
              >
                Start now
              </a>

              {isDemo && (
                <p className="text-xs text-warn mt-3">
                  Demonstration mode: continuing will not charge you and will not create a real
                  trading account.
                </p>
              )}
            </section>

            {preview && preview.productionBlockers.length > 0 && (
              <Callout tone="warn" title="Demonstration only">
                <p>
                  {preview.productionBlockers.length} commercial terms are still awaiting owner
                  approval, so this account cannot be sold for real money yet.
                </p>
                <details className="mt-2">
                  <summary className="cursor-pointer underline">Which ones</summary>
                  <ul className="list-disc pl-5 space-y-1 mt-2">
                    {preview.productionBlockers.map((blocker) => (
                      <li key={blocker.code}>{blocker.detail}</li>
                    ))}
                  </ul>
                </details>
              </Callout>
            )}
          </div>
        </div>
      </div>

      {/* Mobile: total and primary action always reachable. */}
      <div className="lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-border bg-surface-raised/95 backdrop-blur px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-fg-subtle truncate">
              {plan.label} account{selectedAddOns.length > 0 && ` + ${selectedAddOns.length} extra${selectedAddOns.length > 1 ? 's' : ''}`}
            </p>
            <p className="text-lg font-bold tnum text-accent">
              {preview?.total.display ?? '—'}
            </p>
          </div>
          <a
            href={checkoutHref}
            className="shrink-0 rounded-lg bg-accent px-5 py-2.5 font-semibold text-bg"
          >
            Start now
          </a>
        </div>
      </div>
    </div>
  );
}
