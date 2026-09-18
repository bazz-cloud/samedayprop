import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { SESSION_COOKIE, clearSessionCookies, revokeSession } from '@/server/auth/session';

export async function POST(request: Request) {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await revokeSession(token);
  await clearSessionCookies();
  return NextResponse.redirect(new URL('/', request.url), 303);
}
