import Link from 'next/link';

/**
 * Site-wide claim bar.
 *
 * The three things that distinguish this program from the rest of the
 * category, on every page, with the action next to them. Each claim is one this
 * system actually enforces: there is no consistency term anywhere in payout
 * eligibility, no evaluation state in the account lifecycle, and no minimum
 * trading day requirement.
 */
export function ValueBar() {
  return (
    <div className="border-b border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-2.5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 sm:justify-between">
        <p className="display text-center text-[13px] sm:text-sm uppercase tracking-tight text-fg">
          No consistency.{' '}
          <span className="text-accent">No evaluation.</span>{' '}
          No minimum trading days.
        </p>
        <Link
          href="/accounts"
          className="display shrink-0 rounded-md bg-accent px-4 py-1.5 text-[13px] uppercase tracking-wide text-bg hover:bg-accent-strong transition-colors"
        >
          Get paid
        </Link>
      </div>
    </div>
  );
}
