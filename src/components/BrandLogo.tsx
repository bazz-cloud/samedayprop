import Link from 'next/link';

/**
 * Brand lockup.
 *
 * The supplied artwork is a JPEG on solid black. It is composited with `screen`
 * so that black drops out against the page ground, and contrast-crushed first
 * so JPEG noise in the black field does not lift as a faint rectangle.
 *
 * The blend and the filter sit on SEPARATE elements on purpose: `filter`
 * creates a stacking context, and on one element the two cancel out into an
 * opaque box. See .logo-screen / .logo-ink.
 */
export function BrandLockup({ className = '' }: { className?: string }) {
  return (
    <Link href="/" className="flex items-center shrink-0" aria-label="Bull Rush Futures — home">
      <span className={`logo-screen ${className}`}>
        <span className="logo-ink brand-lockup block h-12 w-[8.5rem] sm:h-[3.25rem] sm:w-[9.25rem]" />
      </span>
    </Link>
  );
}

/** The bull and its speed slashes alone, isolated from the full lockup. */
export function BullMark({ className = '' }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`logo-screen ${className}`}>
      <span className="logo-ink bull-mark block h-full w-full" />
    </span>
  );
}
