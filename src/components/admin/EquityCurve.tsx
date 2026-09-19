import type { EquityPoint } from '@/server/views/admin-analytics';
import { Money } from '@/domain/money/money';

/**
 * Equity with the trailing threshold plotted beneath it.
 *
 * The gap between the two lines is the account's remaining room, so the shaded
 * band between them IS the subject — not decoration. Where it narrows, the
 * account is close to dying; where the threshold steps up under a rising equity
 * line, the trader has locked in room they cannot lose again.
 *
 * Both lines come from EquityCheckpoint, which stores the threshold that was in
 * force at each observation. Nothing here recomputes history: a threshold
 * reconstructed from today's rules would show what the rules say now, not what
 * the account was actually held to at the time.
 */
export function EquityCurve({ points }: { points: readonly EquityPoint[] }) {
  if (points.length < 2) {
    return (
      <div className="rounded-xl border border-border bg-surface p-6 text-center">
        <p className="no-caps text-sm text-fg-subtle">
          {points.length === 0
            ? 'No equity checkpoints recorded for this account yet.'
            : 'Only one checkpoint recorded — a curve needs at least two.'}
        </p>
      </div>
    );
  }

  const W = 900;
  const H = 260;
  const PAD = { top: 16, right: 92, bottom: 28, left: 72 };

  const equities = points.map((p) => Number(p.equityMinor));
  const thresholds = points.map((p) => Number(p.thresholdMinor));
  const rawMin = Math.min(...thresholds);
  const rawMax = Math.max(...equities);
  // A flat account would otherwise divide by zero; give it a visible band.
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.01);
  const yMin = rawMin - span * 0.12;
  const yMax = rawMax + span * 0.12;

  const first = points[0]!.observedAt.getTime();
  const last = points[points.length - 1]!.observedAt.getTime();
  const timeSpan = last - first || 1;

  const x = (point: EquityPoint) =>
    PAD.left + ((point.observedAt.getTime() - first) / timeSpan) * (W - PAD.left - PAD.right);
  const y = (value: number) =>
    PAD.top + ((yMax - value) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);

  const line = (pick: (p: EquityPoint) => number) =>
    points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p)} ${y(pick(p))}`).join(' ');

  const equityPath = line((p) => Number(p.equityMinor));
  const thresholdPath = line((p) => Number(p.thresholdMinor));
  const bandPath = `${equityPath} ${points
    .slice()
    .reverse()
    .map((p) => `L ${x(p)} ${y(Number(p.thresholdMinor))}`)
    .join(' ')} Z`;

  const last_ = points[points.length - 1]!;
  const gridValues = [rawMin, (rawMin + rawMax) / 2, rawMax];

  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-labelledby="ec-t ec-d">
        <title id="ec-t">Account equity above its trailing drawdown threshold</title>
        <desc id="ec-d">
          Equity over time with the trailing threshold below it. The shaded band between the two is
          the room remaining before a breach. Latest equity{' '}
          {Money.fromMinor(last_.equityMinor).format()}, threshold{' '}
          {Money.fromMinor(last_.thresholdMinor).format()}.
        </desc>

        {gridValues.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(value)}
              y2={y(value)}
              stroke="var(--color-border)"
            />
            <text
              x={PAD.left - 8}
              y={y(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--color-fg-subtle)"
            >
              {Money.fromMinor(BigInt(Math.round(value))).format()}
            </text>
          </g>
        ))}

        <path d={bandPath} fill="var(--color-accent)" opacity="0.1" />
        <path d={thresholdPath} fill="none" stroke="var(--color-fg)" strokeWidth="2" />
        <path
          d={equityPath}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        <text x={W - PAD.right + 8} y={y(Number(last_.equityMinor)) + 4} fontSize="11" fill="var(--color-accent)">
          Equity
        </text>
        <text x={W - PAD.right + 8} y={y(Number(last_.thresholdMinor)) + 4} fontSize="11" fill="var(--color-fg)">
          Threshold
        </text>
      </svg>

      <figcaption className="no-caps mt-2 text-xs text-fg-subtle">
        The shaded band is the room remaining before a breach. The threshold never falls.
      </figcaption>
    </figure>
  );
}
