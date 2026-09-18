import Link from 'next/link';
import type { AuthenticatedUser } from '@/server/auth/session';
import { ADMIN_ROLES } from '@/server/auth/session';

const NAV = [
  { href: '/accounts', label: 'Accounts' },
  { href: '/rules', label: 'How it works' },
  { href: '/faq', label: 'FAQ' },
  { href: '/contact', label: 'Support' },
];

export function SiteHeader({ user }: { user: AuthenticatedUser | null }) {
  const isAdmin = user ? ADMIN_ROLES.includes(user.role) : false;

  return (
    <header className="border-b border-border bg-surface/60 backdrop-blur sticky top-0 z-40">
      <nav
        aria-label="Primary"
        className="mx-auto max-w-7xl px-4 h-16 flex items-center justify-between gap-4"
      >
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <span
            aria-hidden="true"
            className="h-7 w-7 rounded-md border border-accent/40 bg-accent-dim grid place-items-center text-accent text-xs font-bold"
          >
            {/* Placeholder mark. No real logo has been supplied. */}
            SF
          </span>
          <span className="font-semibold tracking-tight hidden sm:inline">
            Simulated Futures
          </span>
        </Link>

        <ul className="hidden md:flex items-center gap-1 text-sm">
          {NAV.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="px-3 py-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-raised transition-colors"
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2 text-sm">
          {user ? (
            <>
              {isAdmin && (
                <Link
                  href="/admin"
                  className="px-3 py-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-raised"
                >
                  Admin
                </Link>
              )}
              <Link
                href="/dashboard"
                className="px-3 py-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-raised"
              >
                Dashboard
              </Link>
              <form action="/api/auth/logout" method="post">
                <button
                  type="submit"
                  className="px-3 py-2 rounded-md text-fg-subtle hover:text-fg"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <>
              <Link
                href="/login"
                className="px-3 py-2 rounded-md text-fg-muted hover:text-fg hover:bg-surface-raised"
              >
                Sign in
              </Link>
              <Link
                href="/accounts"
                className="px-3 py-2 rounded-md bg-accent text-bg font-semibold hover:bg-accent-strong transition-colors"
              >
                Get an account
              </Link>
            </>
          )}
        </div>
      </nav>
    </header>
  );
}
