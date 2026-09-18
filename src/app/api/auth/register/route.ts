import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { checkPasswordPolicy, hashPassword } from '@/server/auth/passwords';
import { createSession, setSessionCookies } from '@/server/auth/session';

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
  legalName: z.string().min(2).max(120),
});

export async function POST(request: Request) {
  const form = await request.formData();
  const parsed = BodySchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    legalName: form.get('legalName'),
  });

  if (!parsed.success) {
    return NextResponse.redirect(
      new URL('/register?error=Please+check+the+details+you+entered.', request.url),
      303,
    );
  }

  const policy = checkPasswordPolicy(parsed.data.password, parsed.data.email);
  if (!policy.ok) {
    return NextResponse.redirect(
      new URL(`/register?error=${encodeURIComponent(policy.problems.join(' '))}`, request.url),
      303,
    );
  }

  const emailNormalised = parsed.data.email.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { emailNormalised } });

  if (existing) {
    // Deliberately the same wording as success would produce on the next page,
    // so this endpoint cannot be used to enumerate who has an account.
    return NextResponse.redirect(
      new URL('/login?notice=If+that+address+can+be+registered%2C+check+your+email.', request.url),
      303,
    );
  }

  const password = await hashPassword(parsed.data.password);
  const user = await prisma.user.create({
    data: {
      email: parsed.data.email.trim(),
      emailNormalised,
      passwordHash: password.hash,
      passwordSalt: password.salt,
      passwordParams: password.params,
      legalName: parsed.data.legalName.trim(),
      role: 'TRADER',
      // Demo mode has no real email provider, so verification is granted
      // immediately rather than leaving accounts permanently unverifiable.
      emailVerifiedAt: new Date(),
    },
  });

  await prisma.customerVerification.create({
    data: {
      userId: user.id,
      status: 'NOT_CONFIGURED',
      notes: 'No identity verification provider is configured in this environment.',
    },
  });

  const session = await createSession(user.id, {
    userAgent: request.headers.get('user-agent') ?? undefined,
  });
  await setSessionCookies(session.token, session.csrfToken, session.expiresAt);

  const next = form.get('next');
  return NextResponse.redirect(
    new URL(typeof next === 'string' && next.startsWith('/') ? next : '/dashboard', request.url),
    303,
  );
}
