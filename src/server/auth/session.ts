/**
 * Session management.
 *
 * The raw session token exists only in the customer's cookie. The database
 * stores its SHA-256, so a leaked database backup cannot be used to
 * impersonate anyone.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/config';

export const SESSION_COOKIE = 'sdp_session';
export const CSRF_COOKIE = 'sdp_csrf';
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours

export type UserRole = 'OWNER' | 'FINANCE' | 'SUPPORT' | 'RISK' | 'TRADER';

export const ADMIN_ROLES: readonly UserRole[] = ['OWNER', 'FINANCE', 'SUPPORT', 'RISK'];

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export async function createSession(
  userId: string,
  evidence: { ipAddress?: string; userAgent?: string } = {},
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomBytes(32).toString('base64url');
  const csrfToken = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await prisma.session.create({
    data: {
      tokenHash: hashToken(token),
      userId,
      expiresAt,
      ipAddress: evidence.ipAddress ?? null,
      userAgent: evidence.userAgent ?? null,
    },
  });

  return { token, csrfToken, expiresAt };
}

export interface AuthenticatedUser {
  readonly id: string;
  readonly email: string;
  readonly role: UserRole;
  readonly legalName: string | null;
  readonly emailVerifiedAt: Date | null;
  readonly mfaEnabledAt: Date | null;
}

export async function getCurrentUser(): Promise<AuthenticatedUser | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session) return null;
  if (session.revokedAt) return null;
  if (session.expiresAt.getTime() < Date.now()) return null;
  if (session.user.disabledAt) return null;

  return {
    id: session.user.id,
    email: session.user.email,
    role: session.user.role as UserRole,
    legalName: session.user.legalName,
    emailVerifiedAt: session.user.emailVerifiedAt,
    mfaEnabledAt: session.user.mfaEnabledAt,
  };
}

export async function requireUser(): Promise<AuthenticatedUser> {
  const user = await getCurrentUser();
  if (!user) throw new UnauthorizedError('Sign in to continue.');
  return user;
}

/**
 * Privileged roles additionally require MFA to be enrolled.
 *
 * An admin session can move money and change rules; a password alone is not
 * enough to protect that.
 */
export async function requireRole(...allowed: UserRole[]): Promise<AuthenticatedUser> {
  const user = await requireUser();
  if (!allowed.includes(user.role)) {
    throw new ForbiddenError('You do not have access to this area.');
  }
  if (ADMIN_ROLES.includes(user.role) && !user.mfaEnabledAt) {
    throw new ForbiddenError(
      'Multi-factor authentication must be enrolled before using privileged areas.',
    );
  }
  return user;
}

export async function revokeSession(token: string): Promise<void> {
  await prisma.session
    .update({ where: { tokenHash: hashToken(token) }, data: { revokedAt: new Date() } })
    .catch(() => undefined);
}

export async function setSessionCookies(
  token: string,
  csrfToken: string,
  expiresAt: Date,
): Promise<void> {
  const config = getConfig();
  const store = await cookies();

  store.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    expires: expiresAt,
  });
  // Readable by script on purpose: the double-submit CSRF pattern needs the
  // page to echo it back in a header or form field.
  store.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    sameSite: 'lax',
    secure: config.secureCookies,
    path: '/',
    expires: expiresAt,
  });
}

export async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

/** Double-submit CSRF check for state-changing requests. */
export async function assertCsrf(submitted: string | null): Promise<void> {
  const store = await cookies();
  const expected = store.get(CSRF_COOKIE)?.value;
  if (!expected || !submitted) {
    throw new ForbiddenError('Missing CSRF token.');
  }
  const a = Buffer.from(submitted);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new ForbiddenError('Invalid CSRF token.');
  }
}

export class UnauthorizedError extends Error {}
export class ForbiddenError extends Error {}
