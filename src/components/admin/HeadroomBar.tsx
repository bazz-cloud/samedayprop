import type { Headroom } from '@/domain/analytics/exposure';
import { Money } from '@/domain/money/money';

/**
 * Headroom as a bar, not a number.
 *
 * The point of this column is spotting the accounts about to die without
 * opening anything, and a column of dollar figures does not do that — $400 is
 * fine on one tier and fatal on another. The bar is proportional to the
 * account's OWN limit, so tiers are comparable at a glance.
 *
 * The band is also written out as text. Colour alone would make the most
 * important column on the screen unreadable to a colour-blind reader, and this
 * palette has no red to spend on it anyway.
 */
export function HeadroomBar({ headroom, label }: { headroom: Headroom; label: string }) {
  const percent = headroom.fraction === null ? 0 : Math.round(headroom.fraction * 100);
  const fill =
    headroom.band === 'CRITICAL'
      ? 'bg-fg'
      : headroom.band === 'TIGHT'
        ? 'bg-accent/50'
        : 'bg-accent';

  return (
    <div className="min-w-[7rem]">
      <div className="flex items-baseline justify-between gap-2">
        <span className="no-caps tnum text-xs font-bold">
          {Money.fromMinor(headroom.remainingMinor).format()}
        </span>
        {headroom.band !== 'COMFORTABLE' && (
          <span className="no-caps text-[10px] font-bold uppercase tracking-wide">
            {headroom.band === 'CRITICAL' ? 'Critical' : 'Tight'}
          </span>
        )}
      </div>
      <div
        className="mt-1 h-1.5 w-full rounded-full bg-border overflow-hidden"
        role="img"
        aria-label={`${label}: ${percent}% of the limit remaining, ${headroom.band.toLowerCase()}`}
      >
        <div className={`h-full ${fill}`} style={{ width: `${Math.min(100, percent)}%` }} />
      </div>
    </div>
  );
}
