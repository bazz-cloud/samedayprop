import Image from 'next/image';
import Link from 'next/link';

/**
 * Brand marks.
 *
 * The supplied artwork was a JPEG on a solid black field. `scripts/build-logo-assets.mjs`
 * converts it to real alpha by treating the black as a matte — alpha is each
 * pixel's peak channel, and the colour is recovered by dividing it back out —
 * then crops to the ink and splits the bull from the wordmark at the gutter.
 *
 * Because these carry genuine transparency, they need no blend mode and no
 * filter, and they work on any background rather than only dark ones.
 */

/** Full lockup: bull, slashes and wordmark. 1272x399 (3.19:1). */
export function BrandLockup({ className = 'h-12 w-auto sm:h-[3.25rem]' }: { className?: string }) {
  return (
    <Link href="/" className="flex items-center shrink-0" aria-label="Bull Rush Futures — home">
      <Image
        src="/brand/bull-rush-futures.png"
        alt="Bull Rush Futures"
        width={1272}
        height={399}
        priority
        className={className}
      />
    </Link>
  );
}

/** The bull and its speed slashes alone. 502x399 (1.26:1). */
export function BullMark({
  className = '',
  priority = false,
}: {
  className?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/brand/bull-mark.png"
      alt=""
      aria-hidden="true"
      width={502}
      height={399}
      priority={priority}
      className={className}
    />
  );
}
