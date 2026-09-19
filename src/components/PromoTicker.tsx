import { DEFAULT_COUPON } from '@/domain/pricing/coupon';

/**
 * The discount code, scrolling, on every page.
 *
 * The code is not applied for you — it is typed in at checkout — so it has to
 * be somewhere you cannot miss, on the page you are on when you decide to buy.
 * A rolling strip does that without taking a fixed slot in the layout.
 *
 * Three things keep it from being the cheap version of itself:
 *
 *  - The text is duplicated and the track is translated by exactly -50%, so the
 *    loop is seamless rather than snapping back at the end.
 *  - `prefers-reduced-motion` stops the animation outright and centres the
 *    content. A moving strip is a genuine accessibility problem for some
 *    people, and "slower" is not the fix.
 *  - The copy states the terms it is offering — the percentage, and that it
 *    does not expire — rather than manufacturing urgency about an offer that
 *    has no end date. Saying "ends soon" about a coupon with no expiry would be
 *    the first false claim on the site.
 *
 * The strip is `aria-hidden` and the same sentence is repeated once for screen
 * readers, so the loop is not read out four times.
 */
export function PromoTicker() {
  const coupon = DEFAULT_COUPON.value;
  const percent = Number(coupon.percentOff);

  const message = (
    <>
      <span className="text-accent">{coupon.code}</span>
      <span className="text-fg-subtle">·</span>
      <span>{percent}% off every account</span>
      <span className="text-fg-subtle">·</span>
      <span className="text-fg-muted">Enter it at checkout</span>
      <span className="text-fg-subtle">·</span>
      <span className="text-fg-muted">No expiry, no limit on uses</span>
      <span className="text-fg-subtle">·</span>
    </>
  );

  return (
    <div className="border-b border-border bg-surface overflow-hidden">
      <div className="promo-ticker py-2">
        <div className="promo-ticker-track" aria-hidden="true">
          {[0, 1].map((copy) => (
            <div key={copy} className="promo-ticker-run">
              {[0, 1, 2, 3].map((repeat) => (
                <span key={repeat} className="promo-ticker-item">
                  {message}
                </span>
              ))}
            </div>
          ))}
        </div>
        <p className="sr-only">
          Discount code {coupon.code}: {percent}% off every account. Enter it at checkout. It does
          not expire and there is no limit on how many people use it.
        </p>
      </div>
    </div>
  );
}
