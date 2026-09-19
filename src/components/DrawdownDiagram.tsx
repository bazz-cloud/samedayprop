/**
 * Intraday trailing drawdown, drawn.
 *
 * The rule has four moving parts that bullets state but do not show: equity
 * moves both ways, the threshold only ever moves up, it never stops climbing,
 * and a withdrawal drops equity while leaving the threshold where it is. Those
 * relationships are spatial, so a picture carries them in one pass where a list
 * needs five sentences and still leaves people guessing.
 *
 * Figures are the $50,000 account: S = $50,000, D = $1,800, so the threshold
 * opens at $48,200 and thereafter sits exactly $1,800 under the best equity the
 * account has ever shown. (An earlier version of this drawing used $2,000 and a
 * $50,100 stop; both were wrong — the allowance is $1,800 and the owner's rule
 * has no stop.)
 *
 * The single most important thing the picture now shows is the CONSEQUENCE of
 * having no stop: the vertical gap between the two lines can never exceed the
 * allowance, so the most any one withdrawal can take is the allowance.
 *
 * Drawn with currentColor and the theme tokens rather than fixed hex, so it
 * reads correctly on the site's near-black ground.
 */
export function DrawdownDiagram() {
  // Plot area in user units. Y is inverted by yFor().
  const W = 720;
  const H = 300;
  const PAD = { top: 18, right: 116, bottom: 34, left: 58 };

  const yMin = 47_900;
  const yMax = 53_100;
  const yFor = (value: number) =>
    PAD.top + ((yMax - value) / (yMax - yMin)) * (H - PAD.top - PAD.bottom);
  const xFor = (t: number) => PAD.left + t * (W - PAD.left - PAD.right);

  // Equity: opens flat, runs up, gives a little back, drops on the withdrawal.
  const equity: [number, number][] = [
    [0, 50_000],
    [0.14, 50_400],
    [0.26, 50_050],
    [0.42, 51_600],
    [0.54, 51_200],
    [0.66, 52_500],
    [0.74, 52_500],
    [0.75, 51_500],
    [1, 51_800],
  ];

  // Threshold: H - 1,800, always. Steps up on each new high, never down, and
  // never flattens out at a stop, because there is no stop.
  const threshold: [number, number][] = [
    [0, 48_200],
    [0.14, 48_200],
    [0.14, 48_600],
    [0.42, 48_600],
    [0.42, 49_800],
    [0.66, 49_800],
    [0.66, 50_700],
    [1, 50_700],
  ];

  const path = (points: [number, number][]) =>
    points.map(([t, v], i) => `${i === 0 ? 'M' : 'L'} ${xFor(t)} ${yFor(v)}`).join(' ');

  const gridLines = [48_200, 50_700, 52_500];

  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby="dd-title dd-desc"
      >
        <title id="dd-title">
          Trailing threshold stepping up beneath a rising equity line, always $1,800 below the
          highest equity
        </title>
        <desc id="dd-desc">
          Equity starts at $50,000 and rises to $52,500, moving down as well as up. The threshold
          starts at $48,200 and steps upward each time equity makes a new high, never falling and
          never stopping, so it stays exactly $1,800 below the best equity the account has shown.
          A withdrawal near the right drops equity by $1,000 while the threshold stays at $50,700,
          so the gap between them narrows to $800.
        </desc>

        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yFor(value)}
              y2={yFor(value)}
              stroke="var(--color-border)"
            />
            <text
              x={PAD.left - 8}
              y={yFor(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--color-fg-subtle)"
            >
              {`$${(value / 1000).toFixed(1)}k`}
            </text>
          </g>
        ))}

        {/* The gap between equity and threshold is the room you have left. */}
        <path
          d={`${path(equity)} L ${xFor(1)} ${yFor(50_700)} L ${xFor(0)} ${yFor(48_200)} Z`}
          fill="var(--color-accent)"
          opacity="0.08"
        />

        <path d={path(threshold)} fill="none" stroke="var(--color-fg)" strokeWidth="2.5" />
        <path
          d={path(equity)}
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="2.5"
          strokeLinejoin="round"
        />

        {/* The gap at the peak IS the allowance: the widest it can ever be. */}
        <line
          x1={xFor(0.7)}
          x2={xFor(0.7)}
          y1={yFor(52_500)}
          y2={yFor(50_700)}
          stroke="var(--color-fg)"
          strokeWidth="1.5"
        />
        <text
          x={xFor(0.7) + 8}
          y={yFor(51_600) + 4}
          fontSize="11"
          fill="var(--color-fg)"
        >
          $1,800 — all the room there is
        </text>

        {/* Marker: the withdrawal. Equity drops, the threshold does not move. */}
        <circle cx={xFor(0.75)} cy={yFor(51_500)} r="4.5" fill="var(--color-accent)" />
        <text x={xFor(0.75) + 9} y={yFor(51_300)} fontSize="11" fill="var(--color-accent)">
          Withdraw $1,000
        </text>

        <text x={W - PAD.right + 10} y={yFor(51_800) + 4} fontSize="11" fill="var(--color-accent)">
          Equity
        </text>
        <text x={W - PAD.right + 10} y={yFor(50_700) + 4} fontSize="11" fill="var(--color-fg)">
          Threshold
        </text>

        <text x={PAD.left} y={H - 8} fontSize="11" fill="var(--color-fg-subtle)">
          One trading session
        </text>
      </svg>

      <figcaption className="no-caps mt-3 space-y-1 text-xs text-fg-subtle leading-relaxed">
        <p>
          The threshold steps up on every new high, never steps back down, and never stops rising.
          It sits $1,800 under your best equity for as long as the account is open.
        </p>
        <p>
          So the gap between the two lines is never wider than $1,800 — and that gap is the ceiling
          on any single withdrawal. A withdrawal lowers equity only, so it spends the room between
          them.
        </p>
      </figcaption>
    </figure>
  );
}
