import Link from 'next/link';
import type { PlanView } from '@/server/views/catalog-view';

/**
 * Three plan cards, replacing the eight-column table as the primary UI.
 *
 * The table rendered figures adjacent with no separator — "$261.75$349.00
 * one-time" — which is unreadable at a glance and is exactly what a pricing
 * page cannot afford. Every figure here gets its own line, its own label and
 * the monospace face.
 *
 * Three cards, not five: a visitor comparing five columns is doing work the
 * page should have done. The two largest sizes sit below as chips, and every
 * per-size figure lives on the rules page, where each rule carries its own
 * table across all five.
 */

const TIERS = [
  { key: 'SIM_25K', name: 'Starter' },
  { key: 'SIM_50K', name: 'Standard', featured: true },
  { key: 'SIM_100K', name: 'Scale' },
] as const;

export function PlanCards({ plans }: { plans: readonly PlanView[] }) {
  const cards = TIERS.map((tier) => ({
    ...tier,
    plan: plans.find((p) => p.key === tier.key),
  })).filter((card): card is typeof card & { plan: PlanView } => card.plan !== undefined);

  const rest = plans.filter((plan) => !TIERS.some((tier) => tier.key === plan.key));

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-3">
        {cards.map(({ key, name, plan, ...tier }) => {
          const featured = 'featured' in tier && tier.featured;
          return (
            <div
              key={key}
              className={`relative flex flex-col rounded-xl border p-6 ${
                featured
                  ? 'border-accent bg-card-accent'
                  : 'border-border-strong bg-card'
              }`}
            >
              {featured && (
                <span
                  className="absolute -top-2.5 left-6 rounded bg-accent px-2 py-0.5 text-[11px] font-bold uppercase tracking-[0.12em] text-black"
                  style={{ fontFamily: 'var(--font-mono)' }}
                >
                  Most chosen
                </span>
              )}

              <p className="label">{name}</p>
              <p className="tnum mt-2 text-3xl font-bold">{plan.label}</p>
              <p className="no-caps mt-1 text-sm text-fg-subtle">
                <span className="tnum">{plan.positionCeiling.minis}</span> minis or{' '}
                <span className="tnum">{plan.positionCeiling.micros}</span> micros
              </p>

              <div className="mt-5 flex items-baseline gap-3">
                <span className="tnum text-2xl font-bold text-accent">
                  {plan.couponPrice.display}
                </span>
                <span className="was-price tnum text-sm">
                  {plan.listPrice.display}
                </span>
              </div>
              <p className="no-caps mt-1 text-xs text-fg-fine">
                One payment. Nothing renews. Plus 6% MI sales tax.
              </p>

              <hr className="my-5 border-border" />

              <dl className="space-y-3 text-sm">
                <Row label="Trailing drawdown" value={plan.drawdownAllowance.display} />
                <Row label="Daily loss limit" value={plan.dailyLossLimit.display} />
                <Row label="First payout at" value={plan.firstWithdrawalAt.display} />
                <Row label="Daily payout cap" value={plan.dailyCashCap.display} />
                <Row
                  label="Lifetime payout cap"
                  value={
                    plan.lifetimeCapResolved
                      ? (plan.lifetimeCapDescription.split(' ')[0] ?? '—')
                      : 'Not decided'
                  }
                />
              </dl>

              <Link
                href={`/checkout?plan=${plan.key}`}
                className={`no-caps mt-6 block rounded-[9px] px-6 py-3.5 text-center font-semibold transition-colors ${
                  featured
                    ? 'bg-accent text-black hover:bg-accent-strong'
                    : 'border border-border-bold text-fg hover:border-accent hover:text-accent'
                }`}
              >
                Start now
              </Link>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {rest.map((plan) => (
          <Link
            key={plan.key}
            href={`/checkout?plan=${plan.key}`}
            className="tnum rounded-lg border border-border-bold px-4 py-2 text-sm hover:border-accent hover:text-accent transition-colors"
          >
            {plan.label} <span className="text-fg-subtle">·</span> {plan.couponPrice.display}
          </Link>
        ))}
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="no-caps text-fg-subtle">{label}</dt>
      <dd className="tnum font-medium">{value}</dd>
    </div>
  );
}

/**
 * The three things a pricing page should say and usually does not.
 *
 * The drawdown explanation uses the $50,000 account's real figures rather than
 * describing the mechanism abstractly: "it follows your highest balance up" is
 * a sentence people nod at and misunderstand.
 */
export function PricingFootnotes({ fiftyK }: { fiftyK: PlanView }) {
  return (
    <div className="grid gap-4 md:grid-cols-3">
      <div className="rounded-xl border border-border-strong bg-card p-5">
        <p className="label">What the drawdown actually means</p>
        <p className="no-caps mt-3 text-sm text-fg-muted leading-relaxed">
          On a <span className="tnum">{fiftyK.label}</span> account the floor starts at{' '}
          <span className="tnum">{fiftyK.initialThreshold.display}</span> and follows your highest
          simulated balance up. It never moves back down and it never stops rising, so it always
          sits <span className="tnum">{fiftyK.drawdownAllowance.display}</span> below your best
          equity. Touch it and the account ends.
        </p>
      </div>

      <div className="rounded-xl border border-border-strong bg-card-danger p-5">
        <p className="label text-danger">What happens if you breach</p>
        <p className="no-caps mt-3 text-sm text-fg-muted leading-relaxed">
          Access to that account ends. The fee is not refunded, and there is no free reset — a reset
          is a separate purchase, and it does not restore payout capacity you have already used.
        </p>
      </div>

      <div className="rounded-xl border border-border-strong bg-card p-5">
        <p className="label">The account has a finish line</p>
        <p className="no-caps mt-3 text-sm text-fg-muted leading-relaxed">
          Each account pays out up to{' '}
          <span className="tnum">
            {fiftyK.lifetimeCapResolved
              ? (fiftyK.lifetimeCapDescription.split(' ')[0] ?? '')
              : ''}
          </span>{' '}
          in total. Reach it and the account closes as complete — not a breach, nothing forfeited.
          Keep trading by buying a new one. A reset does not reopen it.
        </p>
      </div>
    </div>
  );
}
