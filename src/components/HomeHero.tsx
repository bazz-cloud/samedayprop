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
  const claims = [
    { text: 'NO CONSISTENCY.', delay: '0.85s', tone: 'text-fg' },
    { text: 'NO EVALUATION.', delay: '1.05s', tone: 'text-accent' },
    { text: 'SIMPLE SAME-DAY', delay: '1.25s', tone: 'text-fg' },
    { text: 'PAYOUT RULES.', delay: '1.25s', tone: 'text-fg', sameLine: true },
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
            <BullMark className="anim-bull mx-auto block h-44 w-52 sm:h-56 sm:w-64 lg:mx-0 lg:h-72 lg:w-80" />
          </div>

          {/* ---- the claims ----------------------------------------------- */}
          <div className="lg:col-span-8 order-2">
            <h1 id="hero-heading" className="sr-only">
              Bull Rush Futures — no consistency rule, no evaluation, simple same-day payout rules
            </h1>

            <div
              aria-hidden="true"
              className="display text-[2.15rem] leading-[1.05] sm:text-6xl lg:text-7xl uppercase tracking-tighter"
            >
              <span
                className="anim-word block italic text-fg"
                style={{ animationDelay: claims[0]!.delay }}
              >
                No consistency.
              </span>
              <span
                className="anim-word block italic text-accent"
                style={{ animationDelay: claims[1]!.delay }}
              >
                No evaluation.
              </span>
              <span
                className="anim-word block italic text-fg"
                style={{ animationDelay: claims[2]!.delay }}
              >
                Simple same-day
              </span>
              <span
                className="anim-word block italic text-fg"
                style={{ animationDelay: '1.4s' }}
              >
                payout rules.
              </span>
            </div>

            <p
              className="anim-rise mt-6 max-w-xl text-fg-muted leading-relaxed"
              style={{ animationDelay: '1.7s' }}
            >
              Buy a simulated futures account and trade it the same day. No challenge to pass, no
              best-day test deciding how much of your profit counts, and no minimum number of
              trading days before your first payout.
            </p>

            <div
              className="anim-rise mt-8 flex flex-wrap items-center gap-3"
              style={{ animationDelay: '1.9s' }}
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
              style={{ animationDelay: '2.1s' }}
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
