/**
 * Deployment-shape configuration.
 *
 * These assertions exist because the same build runs on a developer's laptop
 * and on a public hostname, and three defaults that are harmless in the first
 * place are holes in the second.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { getConfig, resetConfigCache } from '../src/server/config';

const TOUCHED = [
  'APP_MODE',
  'APP_BASE_URL',
  'SESSION_SECRET',
  'VERCEL',
  'VERCEL_URL',
  'VERCEL_PROJECT_PRODUCTION_URL',
  'FORCE_SECURE_COOKIES',
  'PAYMENTS_PUBLIC_KEY',
  'PAYMENTS_SECRET_KEY',
  'TRADOVATE_BASE_URL',
  'TRADOVATE_API_KEY',
  'SMTP_URL',
] as const;

let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  saved = Object.fromEntries(TOUCHED.map((k) => [k, process.env[k]]));
  for (const key of TOUCHED) delete process.env[key];
  resetConfigCache();
});

afterEach(() => {
  for (const key of TOUCHED) {
    const value = saved[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  resetConfigCache();
});

describe('base URL resolution', () => {
  it('defaults to localhost when nothing is hosted', () => {
    expect(getConfig().baseUrl).toBe('http://localhost:3000');
  });

  it('prefers the host-injected production domain over the preview domain', () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop-abc123.vercel.app';
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'samedayprop.vercel.app';
    process.env.SESSION_SECRET = 'set-so-boot-succeeds';
    expect(getConfig().baseUrl).toBe('https://samedayprop.vercel.app');
  });

  it('falls back to the per-deployment preview domain', () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop-abc123.vercel.app';
    process.env.SESSION_SECRET = 'set-so-boot-succeeds';
    expect(getConfig().baseUrl).toBe('https://samedayprop-abc123.vercel.app');
  });

  it('lets an explicit APP_BASE_URL win, without a trailing slash', () => {
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop-abc123.vercel.app';
    process.env.APP_BASE_URL = 'https://bullrushfutures.com/';
    process.env.SESSION_SECRET = 'set-so-boot-succeeds';
    expect(getConfig().baseUrl).toBe('https://bullrushfutures.com');
  });
});

describe('session secret', () => {
  it('allows the public demo fallback on localhost', () => {
    process.env.APP_MODE = 'DEMO';
    expect(() => getConfig()).not.toThrow();
  });

  it('REFUSES the public demo fallback on a hosted deployment', () => {
    // The fallback is a constant in a public repository. Serving it from a
    // reachable hostname means anyone can forge an admin session cookie.
    process.env.APP_MODE = 'DEMO';
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop.vercel.app';
    expect(() => getConfig()).toThrow(/SESSION_SECRET is required for a hosted deployment/);
  });

  it('accepts a hosted deployment once a secret is supplied', () => {
    process.env.APP_MODE = 'DEMO';
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop.vercel.app';
    process.env.SESSION_SECRET = 'a-real-generated-secret';
    expect(getConfig().sessionSecret).toBe('a-real-generated-secret');
  });

  it('never silently downgrades to the demo secret outside DEMO', () => {
    process.env.APP_MODE = 'SANDBOX';
    expect(() => getConfig()).toThrow(/SESSION_SECRET is required outside DEMO mode/);
  });
});

describe('secure cookies', () => {
  it('stays off for plain-HTTP local development', () => {
    process.env.APP_MODE = 'DEMO';
    expect(getConfig().secureCookies).toBe(false);
  });

  it('turns on for a hosted demo, which is served over HTTPS', () => {
    process.env.APP_MODE = 'DEMO';
    process.env.VERCEL = '1';
    process.env.VERCEL_URL = 'samedayprop.vercel.app';
    process.env.SESSION_SECRET = 'a-real-generated-secret';
    expect(getConfig().secureCookies).toBe(true);
  });
});

describe('production launch gate', () => {
  it('still refuses to boot with mock providers', () => {
    process.env.APP_MODE = 'PRODUCTION';
    process.env.SESSION_SECRET = 'a-real-generated-secret';
    expect(() => getConfig()).toThrow(/Refusing to start in PRODUCTION/);
  });
});
