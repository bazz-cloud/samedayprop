import Link from 'next/link';

/**
 * The upgrade rows, on the page where the money is.
 *
 * Checkout is where an extra is actually decided: the account is chosen, the
 * price is on screen, and adding one is a single click instead of a trip back
 * to the configurator. The form follows the pattern the category uses and
 * buyers already read without thinking — a tick box, the name, a `+$` price,
 * one line of detail — because a familiar control is not the part worth being
 * original about.
 *
 * It is also where an upsell does the most damage if it is dishonest, and these
 * two extras raise variance rather than improving anyone's odds. So:
 *
 *  - NOTHING IS PRE-TICKED. Adding is an explicit click, and every added row
 *    has a Remove link on the same screen. A cart that fills itself is theft
 *    with extra steps.
 *  - THE LIMITATION IS ON THE ROW, at the size of the pitch. Not in a tooltip,
 *    not behind a toggle, not a shade dimmer.
 *  - NO COUNTDOWN, NO SOCIAL PROOF. No "day ending in", no "87% of traders add
 *    this", no expiring bundle. We have no such figures, and the payment screen
 *    is the worst possible place to start inventing them.
 *  - ADDING RE-QUOTES ON THE SERVER. Each row is a link that changes which
 *    items are quoted; the browser never computes a price, and a typed coupon
 *    survives the round trip. Links rather than a JavaScript form so the rows
 *    work with scripting disabled.
 */

export interface UpsellOption {
  readonly key: string;
  readonly name: string;
  /** The limit as it stands on this plan today. */
  readonly before: string;
  /** The limit once this is applied. */
  readonly after: string;
  /** What it does NOT do. Never optional, never hidden. */
  readonly limitation: string;
  /** The amount this adds, already discounted if a code is applied. */
  readonly price: string;
  /** Shown struck through when a discount is active. */
  readonly listPrice: string | null;
  readonly selected: boolean;
  /** Where ticking or unticking re-quotes to. */
  readonly toggleHref: string;
  readonly icon: 'gauge' | 'size';
}

export function CheckoutUpsell({ options }: { options: readonly UpsellOption[] }) {
  if (options.length === 0) return null;

  return (
    <div className="space-y-2.5">
      {options.map((option) => (
        <Link
          key={option.key}
          href={option.toggleHref}
          aria-label={`${option.selected ? 'Remove' : 'Add'} ${option.name}, ${option.price}`}
          className={`block rounded-xl border p-4 transition-colors ${
            option.selected
              ? 'border-accent bg-card-accent'
              : 'border-border bg-surface hover:border-border-bold'
          }`}
        >
          <div className="flex items-start gap-3">
            <Box checked={option.selected} />

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="no-caps font-bold">{option.name}</span>
                <span className="tnum shrink-0 text-sm">
                  {option.listPrice && (
                    <span className="was-price mr-2">{option.listPrice}</span>
                  )}
                  <span className="font-bold text-accent">+{option.price}</span>
                </span>
              </div>

              {/* The change as a before and after on THIS account: "+50%" is a
                  percentage of a number the buyer would otherwise look up. */}
              <p className="no-caps mt-1.5 text-sm text-fg-muted">
                <span className="tnum text-fg-subtle line-through">{option.before}</span>{' '}
                <span aria-hidden="true" className="text-fg-subtle">
                  &rarr;
                </span>{' '}
                <span className="tnum font-bold text-fg">{option.after}</span>{' '}
                for the life of the account.
              </p>

              <p className="no-caps mt-1 text-xs text-fg-subtle leading-relaxed">
                {option.limitation}
              </p>

              {option.selected && (
                <span className="no-caps mt-2 inline-block text-xs text-fg-subtle underline">
                  Remove
                </span>
              )}
            </div>

            <Icon kind={option.icon} />
          </div>
        </Link>
      ))}
    </div>
  );
}

/** A tick box drawn rather than rendered: the row is a link, not a form field. */
function Box({ checked }: { checked: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border ${
        checked ? 'border-accent bg-accent text-black' : 'border-border-bold'
      }`}
    >
      {checked && (
        <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="3">
          <path d="M3 8.5 6.5 12 13 4.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </span>
  );
}

/**
 * Inline, monochrome, drawn from the same stroke weight as the rest of the UI.
 * No gold trinkets: the thing being sold is a risk parameter, not a loot box.
 */
function Icon({ kind }: { kind: 'gauge' | 'size' }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      className="h-6 w-6 shrink-0 text-fg-disabled"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {kind === 'gauge' ? (
        <>
          <path d="M4 16a8 8 0 1 1 16 0" />
          <path d="M12 16l4.5-4" />
        </>
      ) : (
        <>
          <path d="M5 20V12" />
          <path d="M12 20V7" />
          <path d="M19 20V4" />
        </>
      )}
    </svg>
  );
}
