/**
 * Intraday trailing drawdown, drawn.
 *
 * The rule has four moving parts that bullets state but do not show: equity
 * moves both ways, the threshold only ever moves up, it stops at S + $100, and
 * a withdrawal drops equity while leaving the threshold where it is. Those
 * relationships are spatial, so a picture carries them in one pass where a list
 * needs five sentences and still leaves people guessing.
 *
 * Figures are the $50,000 account: S = $50,000, D = $2,000, so the threshold
 * opens at $48,000 and caps at $50,100.
 *
 * Drawn with currentColor and the theme tokens rather than fixed hex, so it
 * reads correctly on the site's near-black ground.
 */
export function DrawdownDiagram() {
  // Plot area in user units. Y is inverted by yFor().
  const W = 720;
  const H = 300;
  const PAD = { top: 18, right: 108, bottom: 34, left: 58 };

  const yMin = 47_600;
  const yMax = 53_000;
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
    [0.75, 52_000],
    [1, 52_150],
  ];

  // Threshold: min(S + 100, H - D). Steps up, never down, then flat.
  const threshold: [number, number][] = [
    [0, 48_000],
    [0.14, 48_000],
    [0.14, 48_400],
    [0.42, 48_400],
    [0.42, 49_600],
    [0.66, 49_600],
    [0.66, 50_100],
    [1, 50_100],
  ];

  const path = (points: [number, number][]) =>
    points.map(([t, v], i) => `${i === 0 ? 'M' : 'L'} ${xFor(t)} ${yFor(v)}`).join(' ');

  // $50,000 is deliberately not a gridline: it sits 100 below $50,100, which on
  // this scale puts the two labels on top of each other. The starting balance is
  // where the equity line begins, and the caption names it.
  const gridLines = [48_000, 50_100, 52_500];

  return (
    <figure className="rounded-xl border border-border bg-surface p-4">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full h-auto"
        role="img"
        aria-labelledby="dd-title dd-desc"
      >
        <title id="dd-title">
          Trailing threshold stepping up beneath a rising equity line, then holding flat
        </title>
        <desc id="dd-desc">
          Equity starts at $50,000 and rises to $52,500, moving down as well as up. The threshold
          starts at $48,000 and steps upward each time equity makes a new high, never falling. It
          stops rising at $50,100, which is the starting balance plus $100. A withdrawal near the
          right drops equity by $500 while the threshold stays at $50,100, so the gap between them
          narrows.
        </desc>

        {gridLines.map((value) => (
          <g key={value}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={yFor(value)}
              y2={yFor(value)}
              stroke="var(--color-border)"
              strokeDasharray={value === 50_100 ? '4 4' : undefined}
            />
            <text
              x={PAD.left - 8}
              y={yFor(value) + 4}
              textAnchor="end"
              fontSize="11"
              fill="var(--color-fg-subtle)"
            >
              {`$${(value / 1000).toFixed(value % 1000 === 0 ? 0 : 1)}k`}
            </text>
          </g>
        ))}

        {/* The gap between equity and threshold is the room you have left. */}
        <path
          d={`${path(equity)} L ${xFor(1)} ${yFor(50_100)} L ${xFor(0)} ${yFor(48_000)} Z`}
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

        {/* Marker: the threshold stops rising at S + $100. */}
        <circle cx={xFor(0.66)} cy={yFor(50_100)} r="4.5" fill="var(--color-fg)" />
        <text x={xFor(0.66) + 9} y={yFor(50_100) - 9} fontSize="11" fill="var(--color-fg)">
          Caps at $50,100
        </text>

        {/* Marker: the withdrawal. Equity drops, the threshold does not move. */}
        <line
          x1={xFor(0.75)}
          x2={xFor(0.75)}
          y1={yFor(52_500)}
          y2={yFor(52_000)}
          stroke="var(--color-fg)"
          strokeWidth="1.5"
          strokeDasharray="3 3"
        />
        <circle cx={xFor(0.75)} cy={yFor(52_000)} r="4.5" fill="var(--color-accent)" />
        <text
          x={xFor(0.75) + 9}
          y={yFor(52_300)}
          fontSize="11"
          fill="var(--color-accent)"
        >
          Withdraw $500
        </text>

        <text x={W - PAD.right + 10} y={yFor(52_150) + 4} fontSize="11" fill="var(--color-accent)">
          Equity
        </text>
        <text x={W - PAD.right + 10} y={yFor(50_100) + 4} fontSize="11" fill="var(--color-fg)">
          Threshold
        </text>

        <text x={PAD.left} y={H - 8} fontSize="11" fill="var(--color-fg-subtle)">
          One trading session
        </text>
      </svg>

      <figcaption className="no-caps mt-3 space-y-1 text-xs text-fg-subtle leading-relaxed">
        <p>
          The threshold steps up on every new high and never steps back down. It stops at $50,100:
          your $50,000 starting balance plus $100.
        </p>
        <p>A withdrawal lowers equity only, so it spends the room between the two lines.</p>
      </figcaption>
    </figure>
  );
}
