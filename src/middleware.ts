/**
 * Site-wide password gate.
 *
 * Holds the whole deployment behind one shared password while the site is not
 * ready to be public. This is a curtain, not a security boundary: everyone who
 * gets in shares one secret, so it keeps the site out of search results and
 * away from casual visitors, and it is not a substitute for the per-customer
 * authentication in `src/server/auth`.
 *
 * Off unless `SITE_PASSWORD` is set, so local development is untouched.
 *
 * What is gated: everything. Pages, API routes, and the build's static chunks,
 * which is why the unlock page below is a single self-contained document with
 * no external CSS, script or image — it has to render while nothing else can
 * load. The one exception is the unlock endpoint itself.
 *
 * Two things this deliberately does not do:
 *
 *   - store the password in the cookie. The cookie holds an HMAC of it, so a
 *     stolen cookie does not reveal the password, and changing the password
 *     invalidates every cookie already issued.
 *   - compare the submitted password with `===`. It compares HMACs of both,
 *     which makes any timing difference reveal nothing about the password.
 *
 * Runs on the edge runtime, so it uses Web Crypto rather than node:crypto.
 */

import { NextResponse, type NextRequest } from 'next/server';

const COOKIE = 'site_access';
const UNLOCK_PATH = '/__unlock';
/** Bumping this invalidates every issued cookie. */
const TOKEN_VERSION = 'site-access-v1';

const encoder = new TextEncoder();

async function hmacHex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(key),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/** The cookie value that proves knowledge of the current password. */
function expectedToken(password: string): Promise<string> {
  return hmacHex(password, TOKEN_VERSION);
}

/**
 * Equal-length, value-independent comparison.
 *
 * The inputs are already hex digests of the same length, so this loop runs the
 * same number of iterations whatever the values are.
 */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Only same-site paths, so the unlock form cannot be used as an open redirect.
 * `//evil.example` is a protocol-relative URL, not a local path.
 */
function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) return '/';
  return value;
}

function unlockPage(nextPath: string, failed: boolean): Response {
  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Bull Rush Futures</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    background: #14171a; color: #f4f6f5; padding: 16px;
    font-family: Arial, Helvetica, sans-serif;
  }
  main { width: 100%; max-width: 360px; }
  h1 { font-size: 22px; letter-spacing: -0.01em; margin: 0 0 6px; }
  p { color: #9aa3a0; font-size: 14px; line-height: 1.5; margin: 0 0 20px; }
  label { display: block; font-size: 13px; font-weight: bold; margin-bottom: 6px; }
  input {
    width: 100%; padding: 12px; border-radius: 10px; font-size: 16px;
    border: 1px solid #2c3235; background: #1b1f22; color: inherit;
  }
  input:focus { outline: none; border-color: #46c07f; }
  button {
    width: 100%; margin-top: 14px; padding: 13px; border: 0; border-radius: 10px;
    background: #46c07f; color: #0d1011; font-size: 15px; font-weight: bold; cursor: pointer;
  }
  button:hover { background: #57d190; }
  .error {
    background: #3a1d1f; border: 1px solid #7d3b3f; color: #ffb4b4;
    padding: 10px 12px; border-radius: 10px; font-size: 14px; margin-bottom: 16px;
  }
</style>
</head>
<body>
<main>
  <h1>Bull Rush Futures</h1>
  <p>This site is not open yet. Enter the access password to continue.</p>
  ${failed ? '<div class="error" role="alert">That password is not correct.</div>' : ''}
  <form method="post" action="${UNLOCK_PATH}">
    <input type="hidden" name="next" value="${nextPath.replace(/"/g, '&quot;')}">
    <label for="password">Access password</label>
    <input id="password" name="password" type="password" autocomplete="current-password"
           autofocus required>
    <button type="submit">Enter</button>
  </form>
</main>
</body>
</html>`;

  return new Response(body, {
    status: failed ? 401 : 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-robots-tag': 'noindex, nofollow',
    },
  });
}


/**
 * Content-Security-Policy, with a fresh nonce per request.
 *
 * A nonce rather than 'unsafe-inline': Next injects its own bootstrap and
 * hydration scripts inline, and allowing all inline script to accommodate them
 * would disable the main thing a CSP is for. Next reads the nonce from this
 * header and stamps it onto the scripts it generates.
 *
 * 'strict-dynamic' lets those trusted scripts load the chunks they need without
 * enumerating every hashed filename here.
 *
 * `style-src` keeps 'unsafe-inline'. Styles cannot currently be nonced through
 * Next's style pipeline, and an injected stylesheet is a far smaller problem
 * than injected script.
 *
 * Fontshare is the ONE third-party origin allowed, and only for the typeface:
 * the stylesheet comes from api.fontshare.com and the font files from
 * cdn.fontshare.com. It is not in `connect-src`, so no script can use it as a
 * data channel. Drop self-hosted woff2 files into public/fonts and both entries
 * can come straight back out — see the @font-face block in globals.css.
 */
function contentSecurityPolicy(nonce: string, isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' ${isDev ? "'unsafe-eval'" : ''}`.trim(),
    "style-src 'self' 'unsafe-inline' https://api.fontshare.com",
    "img-src 'self' data: blob:",
    "font-src 'self' data: https://cdn.fontshare.com",
    // No third-party calls are made from the browser. If a payment provider's
    // hosted fields are added later, its origin goes here and nowhere else.
    "connect-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    'upgrade-insecure-requests',
  ].join('; ');
}

/** Attach the policy to a response on its way out, whatever kind it is. */
function withSecurityHeaders<T extends Response>(response: T, nonce: string): T {
  response.headers.set(
    'Content-Security-Policy',
    contentSecurityPolicy(nonce, process.env.NODE_ENV !== 'production'),
  );
  return response;
}

export async function middleware(request: NextRequest) {
  // 128 bits of randomness per request. Reusing a nonce across requests would
  // make it guessable and therefore useless.
  const nonce = Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString('base64');
  const forwarded = new Headers(request.headers);
  forwarded.set('x-nonce', nonce);
  const pass = () => NextResponse.next({ request: { headers: forwarded } });

  const password = process.env.SITE_PASSWORD;
  if (!password || password.trim() === '') return withSecurityHeaders(pass(), nonce);

  const token = await expectedToken(password);
  const presented = request.cookies.get(COOKIE)?.value;
  const unlocked = typeof presented === 'string' && timingSafeEqual(presented, token);

  const { pathname, search } = request.nextUrl;

  if (pathname === UNLOCK_PATH) {
    if (request.method !== 'POST') {
      return withSecurityHeaders(NextResponse.redirect(new URL('/', request.url)), nonce);
    }
    const form = await request.formData();
    const submitted = String(form.get('password') ?? '');
    const nextPath = safeNext(String(form.get('next') ?? '/'));

    // Compare digests rather than the passwords themselves.
    const submittedToken = await hmacHex(submitted, TOKEN_VERSION);
    if (!timingSafeEqual(submittedToken, token)) {
      return withSecurityHeaders(unlockPage(nextPath, true), nonce);
    }

    const response = NextResponse.redirect(new URL(nextPath, request.url), 303);
    response.cookies.set(COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: request.nextUrl.protocol === 'https:',
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
    });
    return withSecurityHeaders(response, nonce);
  }

  if (unlocked) return withSecurityHeaders(pass(), nonce);

  return withSecurityHeaders(unlockPage(`${pathname}${search}`, false), nonce);
}

export const config = {
  // Everything. A locked site that still serves its own JavaScript chunks is
  // not locked; the unlock page needs none of them.
  matcher: '/:path*',
};
