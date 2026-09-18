/**
 * Password hashing with scrypt.
 *
 * scrypt is used rather than a native argon2 binding so the whole application
 * installs and runs with no compilation step, while still being memory-hard.
 * Parameters are stored ALONGSIDE each hash so the cost can be raised later and
 * existing users transparently rehashed on their next successful login.
 */

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

export interface ScryptParams {
  readonly N: number;
  readonly r: number;
  readonly p: number;
  readonly keyLength: number;
}

/** OWASP-aligned defaults: N=2^16, r=8, p=1. */
export const CURRENT_PARAMS: ScryptParams = { N: 65536, r: 8, p: 1, keyLength: 64 };

export interface StoredPassword {
  readonly hash: string;
  readonly salt: string;
  readonly params: string;
}

function maxmemFor(params: ScryptParams): number {
  // Node's default maxmem (32MB) is below what N=65536,r=8 needs.
  return 256 * params.N * params.r * 2;
}

export async function hashPassword(
  password: string,
  params: ScryptParams = CURRENT_PARAMS,
): Promise<StoredPassword> {
  const salt = randomBytes(32);
  const derived = await scrypt(password.normalize('NFKC'), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });
  return {
    hash: derived.toString('base64'),
    salt: salt.toString('base64'),
    params: JSON.stringify(params),
  };
}

export async function verifyPassword(
  password: string,
  stored: StoredPassword,
): Promise<{ valid: boolean; needsRehash: boolean }> {
  let params: ScryptParams;
  try {
    params = JSON.parse(stored.params) as ScryptParams;
  } catch {
    return { valid: false, needsRehash: false };
  }

  const salt = Buffer.from(stored.salt, 'base64');
  const expected = Buffer.from(stored.hash, 'base64');

  const derived = await scrypt(password.normalize('NFKC'), salt, params.keyLength, {
    N: params.N,
    r: params.r,
    p: params.p,
    maxmem: maxmemFor(params),
  });

  const valid = derived.length === expected.length && timingSafeEqual(derived, expected);
  const needsRehash =
    params.N !== CURRENT_PARAMS.N ||
    params.r !== CURRENT_PARAMS.r ||
    params.p !== CURRENT_PARAMS.p ||
    params.keyLength !== CURRENT_PARAMS.keyLength;

  return { valid, needsRehash: valid && needsRehash };
}

export interface PasswordPolicyResult {
  readonly ok: boolean;
  readonly problems: readonly string[];
}

/**
 * Length-first policy. Composition rules (one upper, one symbol...) push people
 * toward predictable substitutions without adding real entropy, so they are
 * deliberately absent.
 */
export function checkPasswordPolicy(password: string, email?: string): PasswordPolicyResult {
  const problems: string[] = [];
  if (password.length < 12) problems.push('Use at least 12 characters.');
  if (password.length > 256) problems.push('Use no more than 256 characters.');
  if (email && password.toLowerCase().includes(email.split('@')[0]!.toLowerCase())) {
    problems.push('Do not include your email address in your password.');
  }
  const COMMON = ['password', '123456', 'qwerty', 'letmein', 'trading', 'futures'];
  if (COMMON.some((c) => password.toLowerCase().includes(c))) {
    problems.push('Avoid common words such as "password" or "trading".');
  }
  return { ok: problems.length === 0, problems };
}
