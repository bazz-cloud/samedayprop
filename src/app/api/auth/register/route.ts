import { NextResponse } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/server/db';
import { checkPasswordPolicy, hashPassword } from '@/server/auth/passwords';
import { createSession, setSessionCookies } from '@/server/auth/session';
import { checkRegistrationIdentity } from '@/domain/customer/profile';
import { isKnownCountryCode } from '@/domain/customer/countries';

const BodySchema = z.object({
  email: z.string().email().max(254),
  password: z.string().min(1).max(256),
  legalName: z.string().min(2).max(120),
  countryCode: z.string().length(2).refine(isKnownCountryCode, 'Unrecognised country'),
  // Date only. Parsed here rather than by the schema so an unparseable value
  // produces the same eligibility message as an out-of-range one.
  dateOfBirth: z.string().min(1).max(32),
});

export async function POST(request: Request) {
  const form = await request.formData();
  const parsed = BodySchema.safeParse({
    email: form.get('email'),
    password: form.get('password'),
    legalName: form.get('legalName'),
    countryCode: form.get('countryCode'),
    dateOfBirth: form.get('dateOfBirth'),
  });

  if (!parsed.success) {
    return NextResponse.redirect(
      new URL('/register?error=Please+check+the+details+you+entered.', request.url),
      303,
    );
  }

  // Age and country decide whether an account may exist at all, so they are
  // checked before the password is even hashed.
  const parsedDob = new Date(`${parsed.data.dateOfBirth}T00:00:00Z`);
  const identity = checkRegistrationIdentity(
    {
      legalName: parsed.data.legalName,
      countryCode: parsed.data.countryCode,
      dateOfBirth: Number.isNaN(parsedDob.getTime()) ? null : parsedDob,
    },
    new Date(),
  );
  if (!identity.ok) {
    return NextResponse.redirect(
      new URL(`/register?error=${encodeURIComponent(identity.messages.join(' '))}`, request.url),
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
      countryCode: parsed.data.countryCode.toUpperCase(),
      dateOfBirth: parsedDob,
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

  await prisma.customerProfile.create({
    data: { userId: user.id, countryCode: parsed.data.countryCode.toUpperCase() },
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
