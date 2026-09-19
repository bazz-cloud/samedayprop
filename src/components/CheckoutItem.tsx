import Link from 'next/link';

/**
 * The thing being bought, shown as a thing rather than a line of text.
 *
 * A checkout that names the product in one sentence and then spends the rest of
 * the page on consent boxes reads like paperwork. The account size gets a tile,
 * the price sits beside it, and the five limits that define the product are on
 * the card — so the last screen before payment shows the same figures as the
 * page that sold it, and a mismatch is visible instead of discovered later.
 */

export interface CheckoutItemSpec {
  readonly label: string;
  readonly value: string;
}

export function CheckoutItem({
  label,
  name,
  listPrice,
  price,
  specs,
  changeHref,
}: {
  /** The account size, e.g. "$50,000". */
  label: string;
  name: string;
  /** Shown struck through only when a discount applies. */
  listPrice: string | null;
  price: string;
  specs: readonly CheckoutItemSpec[];
  changeHref: string;
}) {
  return (
    <div className="rounded-xl border border-border-strong bg-card overflow-hidden">
      <div className="flex flex-wrap items-center gap-4 p-5">
        <div
          aria-hidden="true"
          className="flex h-16 w-24 shrink-0 flex-col items-center justify-center rounded-lg border border-accent/40 bg-card-accent"
        >
          <span className="tnum text-base font-bold text-accent">{label}</span>
          <span className="label mt-0.5 text-[10px] text-fg-subtle">Simulated</span>
        </div>

        <div className="min-w-0 flex-1 basis-[55%]">
          <p className="no-caps font-bold">{name}</p>
          <p className="no-caps mt-0.5 text-xs text-fg-subtle">One-time charge · does not renew</p>
          <Link
            href={changeHref}
            className="no-caps mt-1.5 inline-block text-xs text-accent hover:underline"
          >
            Change account size
          </Link>
        </div>

        {/* Wraps to its own right-aligned line on a phone rather than squeezing
            the name into three lines beside it. */}
        <div className="shrink-0 basis-full text-right sm:basis-auto">
          {listPrice && (
            <p className="tnum text-sm text-fg-disabled line-through">{listPrice}</p>
          )}
          <p className="tnum text-xl font-bold">{price}</p>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-px border-t border-border bg-border sm:grid-cols-3">
        {specs.map((spec) => (
          <div key={spec.label} className="bg-card px-4 py-3">
            <dt className="label text-[10px] text-fg-subtle">{spec.label}</dt>
            <dd className="tnum mt-1 text-sm font-bold">{spec.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** A bought extra: one row, no tile — it is not the product. */
export function CheckoutExtra({
  name,
  listPrice,
  price,
}: {
  name: string;
  listPrice: string | null;
  price: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 rounded-xl border border-border bg-surface px-5 py-3.5">
      <p className="no-caps text-sm font-bold">{name}</p>
      <p className="tnum shrink-0 text-sm">
        {listPrice && <span className="text-fg-disabled line-through mr-2">{listPrice}</span>}
        {price}
      </p>
    </div>
  );
}
