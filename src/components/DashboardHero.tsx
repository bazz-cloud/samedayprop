/**
 * The four things a funded trader needs before they place an order.
 *
 * The old dashboard opened with the account balance, which is the number that
 * matters least: a simulated balance is not cash, and knowing it is $53,240
 * tells you nothing about whether the next trade can end your account. These
 * do, in the order they bite:
 *
 *  1. ROOM TO THE FLOOR — how far equity is above the trailing threshold. This
 *     is the number that ends the account when it reaches zero, and with no
 *     stop on the threshold it can never exceed the drawdown allowance, so the
 *     bar has a fixed and honest maximum.
 *  2. TODAY'S LOSS — how much of the daily limit is spent. Ends the session,
 *     not the account, which is why it is second.
 *  3. SIZE — contracts held against the ceiling.
 *  4. NEXT PAYOUT — either what can be taken right now, or how far off it is.
 *
 * Every figure arrives as a pre-formatted string from the server. Nothing here
 * computes money; the percentages are presentation only, and the label beside
 * each bar always carries the real numbers so the bar is never the only source
 * of truth.
 */

export interface HeroFigure {
  readonly display: string;
}

export interface DashboardHeroProps {
  readonly room: HeroFigure;
  readonly allowance: HeroFigure;
  readonly threshold: HeroFigure;
  /** 0–100, room as a share of the allowance. */
  readonly roomPercent: number;
  readonly dailyUsed: HeroFigure;
  readonly dailyLimit: HeroFigure;
  readonly dailyRemaining: HeroFigure;
  readonly dailyPercent: number;
  readonly contractsHeld: number;
  readonly contractsCap: number;
  readonly payout:
    | { readonly kind: 'available'; readonly cash: string; readonly gross: string }
    | { readonly kind: 'climbing'; readonly remaining: string; readonly target: string; readonly percent: number }
    | { readonly kind: 'blocked'; readonly reason: string };
  readonly tradeable: boolean;
  readonly stale: boolean;
}

/** Bands chosen so the colour changes while there is still time to act on it. */
function roomTone(percent: number): 'accent' | 'fg' | 'danger' {
  if (percent <= 15) return 'danger';
  if (percent <= 40) return 'fg';
  return 'accent';
}

export function DashboardHero(props: DashboardHeroProps) {
  const tone = roomTone(props.roomPercent);

  return (
    <div className="grid gap-4 lg:grid-cols-12">
      {/* ---- 1. Room to the floor ------------------------------------- */}
      <section
        aria-labelledby="room-heading"
        className={`lg:col-span-5 rounded-xl border p-5 sm:p-6 ${
          tone === 'danger' ? 'border-danger/50 bg-card-danger' : 'border-accent/40 bg-card-accent'
        }`}
      >
        <h2 id="room-heading" className="label">
          Room to the floor
        </h2>

        <p
          className={`tnum mt-2 text-4xl sm:text-5xl font-bold ${
            tone === 'danger' ? 'text-danger' : tone === 'fg' ? 'text-fg' : 'text-accent'
          }`}
        >
          {props.room.display}
        </p>

        <Bar
          percent={props.roomPercent}
          tone={tone}
          label={`Room remaining, ${props.roomPercent}% of the allowance`}
        />

        <p className="no-caps mt-3 text-sm text-fg-muted leading-relaxed">
          Lose this and the account ends. Your threshold is at{' '}
          <span className="tnum text-fg">{props.threshold.display}</span> and never moves down, so
          this can never be more than <span className="tnum text-fg">{props.allowance.display}</span>
          .
        </p>
      </section>

      {/* ---- 2 and 3. Today ------------------------------------------- */}
      <section aria-labelledby="today-heading" className="lg:col-span-4 rounded-xl border border-border-strong bg-card p-5 sm:p-6">
        <h2 id="today-heading" className="label">
          Your limits today
        </h2>

        <dl className="mt-4 space-y-5">
          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="no-caps text-sm text-fg-muted">Daily loss</dt>
              <dd className="tnum text-sm">
                <span className="font-bold">{props.dailyUsed.display}</span>
                <span className="text-fg-subtle"> / {props.dailyLimit.display}</span>
              </dd>
            </div>
            <Bar
              percent={props.dailyPercent}
              tone={props.dailyPercent >= 80 ? 'danger' : 'fg'}
              label={`Daily loss used, ${props.dailyPercent}% of the limit`}
            />
            <p className="no-caps mt-1.5 text-xs text-fg-subtle">
              <span className="tnum">{props.dailyRemaining.display}</span> left before trading locks
              until the market reopens.
            </p>
          </div>

          <div>
            <div className="flex items-baseline justify-between gap-3">
              <dt className="no-caps text-sm text-fg-muted">Size</dt>
              <dd className="tnum text-sm">
                <span className="font-bold">{props.contractsHeld}</span>
                <span className="text-fg-subtle"> / {props.contractsCap}</span>
              </dd>
            </div>
            <Bar
              percent={
                props.contractsCap > 0
                  ? Math.min(100, Math.round((props.contractsHeld / props.contractsCap) * 100))
                  : 0
              }
              tone="fg"
              label={`Contracts held, ${props.contractsHeld} of ${props.contractsCap} micro-equivalents`}
            />
            <p className="no-caps mt-1.5 text-xs text-fg-subtle">
              Micro-equivalents. Working orders count too, so two orders cannot fill past the cap.
            </p>
          </div>
        </dl>
      </section>

      {/* ---- 4. Next payout -------------------------------------------- */}
      <section aria-labelledby="payout-heading" className="lg:col-span-3 rounded-xl border border-border-strong bg-card p-5 sm:p-6">
        <h2 id="payout-heading" className="label">
          Next payout
        </h2>

        {props.payout.kind === 'available' && (
          <>
            <p className="tnum mt-2 text-3xl font-bold text-accent">{props.payout.cash}</p>
            <p className="no-caps mt-1 text-sm text-fg-muted">
              in cash, from a <span className="tnum">{props.payout.gross}</span> withdrawal.
            </p>
            <p className="no-caps mt-3 text-xs text-fg-subtle leading-relaxed">
              Available now. The other half is simulated balance that ceases to exist.
            </p>
          </>
        )}

        {props.payout.kind === 'climbing' && (
          <>
            <p className="tnum mt-2 text-3xl font-bold">{props.payout.remaining}</p>
            <p className="no-caps mt-1 text-sm text-fg-muted">
              more to reach <span className="tnum">{props.payout.target}</span>.
            </p>
            <Bar
              percent={props.payout.percent}
              tone="accent"
              label={`Progress to your first payout, ${props.payout.percent}%`}
            />
          </>
        )}

        {props.payout.kind === 'blocked' && (
          <p className="no-caps mt-3 text-sm text-fg-muted leading-relaxed">
            {props.payout.reason}
          </p>
        )}
      </section>

      {/* A state worth interrupting for: figures on screen that we cannot
          vouch for are worse than no figures, so say so across the full width
          rather than tucking it into a corner. */}
      {props.stale && (
        <p
          role="status"
          className="no-caps lg:col-span-12 rounded-xl border border-border-bold bg-surface px-4 py-3 text-sm text-fg"
        >
          These figures are not current. We have not had fresh data from the platform recently, so
          nothing above should be acted on and payouts are held until it returns.
        </p>
      )}

      {!props.tradeable && !props.stale && (
        <p
          role="status"
          className="no-caps lg:col-span-12 rounded-xl border border-border-bold bg-surface px-4 py-3 text-sm text-fg"
        >
          This account cannot trade right now. The figures above are its last known state.
        </p>
      )}
    </div>
  );
}

/**
 * A bar that is never the only source of truth.
 *
 * Every caller puts the real figures next to it, and the bar carries its own
 * text label for a screen reader rather than being decorative width alone.
 */
function Bar({
  percent,
  tone,
  label,
}: {
  percent: number;
  tone: 'accent' | 'fg' | 'danger';
  label: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div
      role="meter"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface"
    >
      <div
        className={`h-full rounded-full ${
          tone === 'danger' ? 'bg-danger' : tone === 'fg' ? 'bg-fg' : 'bg-accent'
        }`}
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}
