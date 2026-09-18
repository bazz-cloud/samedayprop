/**
 * Demo banner.
 *
 * Rendered on every page in DEMO mode, above everything else. The build is full
 * of realistic-looking prices, balances and payout figures; without this it
 * would be easy for someone to take a screenshot of a mock checkout and believe
 * it was live.
 */
export function DemoBanner() {
  return (
    <div
      role="status"
      className="bg-warn-dim border-b border-warn/40 text-warn px-4 py-2 text-center text-sm"
    >
      <strong className="font-semibold">Demonstration mode.</strong>{' '}
      No real money moves, no real trading account is created, and no email is sent.
      Prices and rules shown include unapproved proposed defaults.
    </div>
  );
}
