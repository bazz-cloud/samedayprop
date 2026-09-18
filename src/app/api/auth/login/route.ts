import { NextResponse } from 'next/server';
import { prisma } from '@/server/db';
import { hashPassword, verifyPassword } from '@/server/auth/passwords';
import { createSession, setSessionCookies } from '@/server/auth/session';

const MAX_FAILED = 8;
const LOCKOUT_MS = 15 * 60 * 1000;

export async function POST(request: Request) {
  const form = await request.formData();
  const email = String(form.get('email') ?? '').trim();
  const password = String(form.get('password') ?? '');
  const next = form.get('next');

  const fail = () =>
    NextResponse.redirect(
      new URL('/login?error=Email+or+password+is+incorrect.', request.url),
      303,
    );

  if (!email || !password) return fail();

  const user = await prisma.user.findUnique({ where: { emailNormalised: email.toLowerCase() } });

  if (!user) {
    // Spend comparable time on a miss so response timing does not reveal
    // whether the address is registered.
    await hashPassword(password);
    return fail();
  }

  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    return NextResponse.redirect(
      new URL('/login?error=Too+many+attempts.+Try+again+shortly.', request.url),
      303,
    );
  }
  if (user.disabledAt) return fail();

  const result = await verifyPassword(password, {
    hash: user.passwordHash,
    salt: user.passwordSalt,
    params: user.passwordParams,
  });

  if (!result.valid) {
    const failedLoginCount = user.failedLoginCount + 1;
    await prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount,
        lockedUntil:
          failedLoginCount >= MAX_FAILED ? new Date(Date.now() + LOCKOUT_MS) : user.lockedUntil,
      },
    });
    return fail();
  }

  // Transparent upgrade if the stored parameters are below current cost.
  const data: Record<string, unknown> = { failedLoginCount: 0, lockedUntil: null };
  if (result.needsRehash) {
    const rehashed = await hashPassword(password);
    data.passwordHash = rehashed.hash;
    data.passwordSalt = rehashed.salt;
    data.passwordParams = rehashed.params;
  }
  await prisma.user.update({ where: { id: user.id }, data });

  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent') ?? undefined,
  });
  await setSessionCookies(session.token, session.csrfToken, session.expiresAt);

  return NextResponse.redirect(
    new URL(typeof next === 'string' && next.startsWith('/') ? next : '/dashboard', request.url),
    303,
  );
}
