import Link from 'next/link';

/**
 * The order summary, built to read as a receipt rather than a spec sheet.
 *
 * Checkout pages in this category are usually the weakest page on the site: a
 * wall of consent boxes with the price hidden somewhere inside it. The things
 * that make a page feel like a checkout are cheap and concrete — the item you
 * picked shown as an item, a promo field where people look for one, a running
 * total that does not move when you scroll, and one number labelled with the
 * exact moment it will be charged.
 *
 * Every figure is a string computed on the server from the authoritative quote.
 * Nothing here adds, discounts or rounds anything.
 */

export interface SummaryLine {
  readonly key: string;
  readonly name: string;
  readonly isPlan: boolean;
  /** Before the discount. Shown struck through only when the two differ. */
  readonly subtotal: string;
  readonly total: string;
}

export interface PromoState {
  readonly code: string;
  readonly percentOff: number;
  readonly applied: boolean;
  readonly savingDisplay: string | null;
  readonly rejection: string | null;
  /** plan and addon selections, carried through the GET form. */
  readonly hidden: readonly (readonly [string, string])[];
  /** Where to go to drop the code. */
  readonly removeHref: string;
  /** Where to go to put the advertised code back after a rejected one. */
  readonly defaultHref: string;
}

export function CheckoutSummary({
  lines,
  promo,
  subtotal,
  discount,
  taxDisplay,
  taxLabel = 'Tax',
  taxNotConfigured,
  total,
}: {
  lines: readonly SummaryLine[];
  promo: PromoState;
  subtotal: string;
  discount: string | null;
  taxDisplay: string;
  /** e.g. "Michigan sales tax (6%)". Falls back to "Tax". */
  taxLabel?: string;
  taxNotConfigured: boolean;
  total: string;
}) {
  return (
    <div className="rounded-xl border border-border-strong bg-card overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <p className="label">Order summary</p>
        <Link href="/accounts" className="no-caps text-xs text-fg-subtle hover:text-accent">
          Change
        </Link>
      </div>

      <div className="divide-y divide-border">
        {lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-4 px-5 py-3">
            <div className="min-w-0">
              <p className="no-caps text-sm font-bold truncate">{line.name}</p>
              <p className="no-caps text-xs text-fg-fine">
                {line.isPlan ? 'Account · one-time' : 'Extra · one-time'}
              </p>
            </div>
            <p className="tnum shrink-0 text-sm">
              {line.subtotal === line.total ? (
                line.total
              ) : (
                <>
                  <span className="text-fg-disabled line-through mr-2">{line.subtotal}</span>
                  {line.total}
                </>
              )}
            </p>
          </div>
        ))}
      </div>

      {/* The promo field, where a buyer expects it: in the summary, next to the
          number it changes. Submitting is a GET back to this page, so the code
          is re-validated against live usage on the server and the price is never
          decided in the browser. */}
      <div className="border-t border-border px-5 py-4">
        {promo.applied ? (
          <div className="flex items-center justify-between gap-3">
            {/* Static, not the flashing chip used on the marketing pages: in a
                receipt an applied code is a fact, not an offer. */}
            <span className="coupon-chip">{promo.code}</span>
            <span className="no-caps flex-1 text-xs text-fg-muted">
              {promo.percentOff}% off
              {promo.savingDisplay ? ` — you save ${promo.savingDisplay}` : ''}
            </span>
            <Link
              href={promo.removeHref}
              className="no-caps shrink-0 text-xs text-fg-subtle hover:text-fg underline"
            >
              Remove
            </Link>
          </div>
        ) : (
          <form method="get" action="/checkout" className="flex gap-2">
            {promo.hidden.map(([name, value], index) => (
              <input key={`${name}-${index}`} type="hidden" name={name} value={value} />
            ))}
            <label htmlFor="coupon" className="sr-only">
              Promo code
            </label>
            <input
              id="coupon"
              name="coupon"
              defaultValue=""
              placeholder="Promo code"
              autoComplete="off"
              spellCheck={false}
              className="tnum min-w-0 flex-1 rounded-lg border border-border bg-bg px-3 py-2 text-sm uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal placeholder:text-fg-disabled focus:border-accent"
            />
            <button
              type="submit"
              className="no-caps shrink-0 rounded-lg border border-border-bold px-4 py-2 text-sm font-bold hover:border-accent hover:text-accent transition-colors"
            >
              Apply
            </button>
          </form>
        )}
        {promo.rejection && (
          <p className="no-caps mt-2 text-xs text-fg" role="status">
            {promo.rejection}{' '}
            <Link href={promo.defaultHref} className="text-accent hover:underline">
              Use {promo.code} instead
            </Link>
          </p>
        )}
      </div>

      <dl className="border-t border-border px-5 py-4 text-sm">
        <Line label="Subtotal" value={subtotal} />
        {discount && <Line label={`Code ${promo.code}`} value={`−${discount}`} accent />}
        {/*
          A LINE ITEM, not a marketing claim. "No subscription" in body copy is
          something every firm in this category says; a zero on the invoice is
          checkable.
        */}
        <Line label="Recurring charges" value="$0.00" />
        <Line label={taxLabel} value={taxDisplay} muted />
      </dl>

      <div className="border-t border-border-strong bg-surface px-5 py-4">
        <div className="flex items-baseline justify-between gap-4">
          <p className="text-sm">Due today</p>
          <p className="tnum text-[26px] font-bold text-accent">{total}</p>
        </div>
        <p className="no-caps mt-1 text-xs text-fg-fine">
          Charged once, after you sign. Nothing renews.
        </p>
        {taxNotConfigured && (
          <p className="no-caps mt-2 text-xs text-fg-fine">
            Tax treatment has not been configured, so this total excludes any tax that may apply.
          </p>
        )}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="no-caps text-fg-muted">{label}</dt>
      <dd className={`tnum ${accent ? 'text-accent' : muted ? 'text-fg-subtle' : ''}`}>{value}</dd>
    </div>
  );
}

/**
 * What happens after the button, in the order it happens.
 *
 * Every step here is something the system actually does. There is no delivery
 * estimate, because provisioning depends on a platform partner that is not yet
 * connected, and inventing one would be the first false promise on the page.
 */
export function NextSteps({ isDemo }: { isDemo: boolean }) {
  const steps = [
    ['Sign', 'One PDF covering every document, bound to this exact price.'],
    ['Pay', isDemo ? 'Simulated in demonstration mode — no money moves.' : 'On our provider’s hosted page. No card details touch this site.'],
    ['Trade', 'Sign-in details are shown once, on screen, never emailed.'],
  ] as const;

  return (
    <ol className="rounded-xl border border-border bg-surface px-5 py-4 space-y-3">
      <li className="label">What happens next</li>
      {steps.map(([title, detail], index) => (
        <li key={title} className="flex gap-3">
          <span
            aria-hidden="true"
            className="tnum mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-bold text-[11px] font-bold text-fg-subtle"
          >
            {index + 1}
          </span>
          <p className="no-caps text-xs text-fg-muted leading-relaxed">
            <span className="font-bold text-fg">{title}.</span> {detail}
          </p>
        </li>
      ))}
    </ol>
  );
}
