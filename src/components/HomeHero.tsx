import Link from 'next/link';
import { BullMark } from './BrandLogo';

/**
 * Home hero.
 *
 * The bull charges in from the left, its speed slashes sweep past, a burst
 * fires from the point of impact, and the three claims slam in one after
 * another. The whole sequence runs on CSS alone — no JavaScript, so it plays
 * identically on a cold load — and finishes in about 2.2 seconds at a fully
 * readable resting state.
 *
 * Under `prefers-reduced-motion` the sweep and burst are removed entirely and
 * everything else renders immediately at its final position.
 */
export function HomeHero() {
  /**
   * The same three claims as the site-wide banner, one line each.
   *
   * These drive the render. They previously only supplied the delays while the
   * words themselves were hardcoded in the JSX below, which is how the hero and
   * the banner came to disagree.
   *
   * "No minimum trading days" is split across two lines deliberately: at the
   * display size it wraps anyway, and choosing the break keeps the stagger even.
   */
  const claims = [
    { text: 'No consistency.', delay: '0.85s', tone: 'text-fg' },
    { text: 'No evaluation.', delay: '1.05s', tone: 'text-accent' },
    { text: 'No minimum', delay: '1.25s', tone: 'text-fg' },
    { text: 'trading days.', delay: '1.4s', tone: 'text-fg' },
  ];

  return (
    <section
      aria-labelledby="hero-heading"
      className="relative overflow-hidden border-b border-border"
    >
      {/* ---- burst graphic ------------------------------------------------ */}
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        {/* Radiating burst, anchored where the bull lands. */}
        <div className="absolute left-[18%] top-1/2 -translate-y-1/2">
          <div className="anim-burst h-[34rem] w-[34rem] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-accent/50" />
        </div>
        <div className="absolute left-[18%] top-1/2 -translate-y-1/2">
          <div
            className="anim-burst h-[22rem] w-[22rem] -translate-x-1/2 -translate-y-1/2 rounded-full border border-accent/40"
            style={{ animationDelay: '0.75s' }}
          />
        </div>

        {/* Speed slashes sweeping left to right, echoing the logo's marks. */}
        {[
          { top: '26%', h: 'h-1', w: 'w-40', delay: '0s', opacity: 'bg-accent/70' },
          { top: '42%', h: 'h-1.5', w: 'w-64', delay: '0.08s', opacity: 'bg-accent/50' },
          { top: '58%', h: 'h-1', w: 'w-48', delay: '0.16s', opacity: 'bg-accent/60' },
          { top: '72%', h: 'h-0.5', w: 'w-32', delay: '0.24s', opacity: 'bg-accent/40' },
        ].map((slash) => (
          <span
            key={slash.top}
            className={`anim-slash absolute left-0 origin-left -skew-x-[28deg] rounded-full ${slash.h} ${slash.w} ${slash.opacity}`}
            style={{ top: slash.top, animationDelay: slash.delay }}
          />
        ))}

        {/* A soft green wash so the burst has something to read against. */}
        <div className="absolute inset-0 bg-[radial-gradient(60%_50%_at_20%_50%,rgba(74,222,128,0.10),transparent_70%)]" />
      </div>

      <div className="relative mx-auto max-w-7xl px-4 py-16 sm:py-24">
        <div className="grid items-center gap-8 lg:grid-cols-12">
          {/* ---- the bull ------------------------------------------------- */}
          <div className="lg:col-span-4 order-1">
            <BullMark priority className="anim-bull mx-auto block h-40 w-auto sm:h-52 lg:mx-0 lg:h-72" />
          </div>

          {/* ---- the claims ----------------------------------------------- */}
          <div className="lg:col-span-8 order-2">
            <h1 id="hero-heading" className="sr-only">
              Bull Rush Futures — no consistency rule, no evaluation, no minimum trading days
            </h1>

            <div
              aria-hidden="true"
              className="display text-[2.15rem] leading-[1.05] sm:text-6xl lg:text-7xl uppercase"
            >
              {claims.map((claim) => (
                <span
                  key={claim.text}
                  className={`anim-word block italic ${claim.tone}`}
                  style={{ animationDelay: claim.delay }}
                >
                  {claim.text}
                </span>
              ))}
            </div>

            {/* No marketing paragraph above the fold. What this paragraph used to
                say is now the stat pairs directly below the hero, where it reads
                in one pass instead of three lines. The disclosure under the
                buttons stays: it is a disclosure, not a pitch. */}
            <div
              className="anim-rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: '1.7s' }}
            >
              <Link
                href="/accounts"
                className="display rounded-lg bg-accent px-8 py-4 text-lg uppercase tracking-wide text-bg hover:bg-accent-strong transition-colors"
              >
                Get paid
              </Link>
              <Link
                href="/rules"
                className="rounded-lg border border-border-strong px-6 py-4 font-bold hover:border-accent hover:text-accent transition-colors"
              >
                Read the rules first
              </Link>
            </div>

            <p
              className="anim-rise mt-5 text-xs text-fg-subtle max-w-xl leading-relaxed"
              style={{ animationDelay: '1.9s' }}
            >
              Trading is simulated and the account size is a nominal figure, not cash held for you.
              A $500 gross withdrawal reduces the simulated account by $500 and pays you $250 in
              real cash.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
