/**
 * Platform credentials.
 *
 * A trader needs a username and password to sign in to the trading platform, so
 * we issue them and show them. What we deliberately do NOT do is keep the
 * password retrievable for the life of the account.
 *
 * The shape:
 *   - The USERNAME is not a secret. It is displayed permanently.
 *   - The PASSWORD is stored only as a scrypt hash.
 *   - The initial password is additionally held as AES-256-GCM ciphertext for
 *     exactly as long as it takes the trader to read it once. The moment they
 *     confirm they have saved it, the ciphertext is destroyed and only the hash
 *     remains.
 *   - A lost password is RE-ISSUED, never recovered. Re-issuing rotates it.
 *
 * The alternative — a permanently readable password in the dashboard — means a
 * database leak hands over every trader's platform account at once, and means
 * we hold a credential we have no need to hold. The cost of this design is one
 * click from the trader; the cost of the alternative is borne by them.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/config';
import { hashPassword, verifyPassword } from '@/server/auth/passwords';
import { recordAudit } from './audit-service';

type Tx = Prisma.TransactionClient;

const ALGORITHM = 'aes-256-gcm';

/**
 * Encryption key for the short-lived initial secret.
 *
 * Derived from a dedicated variable where one is set, falling back to the
 * session secret so demo mode works without extra configuration. Production
 * must set CREDENTIAL_ENCRYPTION_KEY: sharing a key between session signing and
 * credential encryption means rotating one forces the other.
 */
function encryptionKey(): Buffer {
  const config = getConfig();
  const material = process.env.CREDENTIAL_ENCRYPTION_KEY ?? config.sessionSecret;
  if (config.mode === 'PRODUCTION' && !process.env.CREDENTIAL_ENCRYPTION_KEY) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY must be set in production. Reusing the session secret to ' +
        'encrypt credentials couples two key rotations that should be independent.',
    );
  }
  return scryptSync(material, 'bullrush-credential-v1', 32);
}

function encrypt(plaintext: string): { cipher: string; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGORITHM, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    cipher: encrypted.toString('base64'),
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
  };
}

function decrypt(cipherText: string, iv: string, tag: string): string {
  const decipher = createDecipheriv(ALGORITHM, encryptionKey(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherText, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

/**
 * Password alphabet.
 *
 * Excludes characters that are read wrongly off a screen — O/0, I/l/1 — because
 * these get retyped by hand into a different application, and a password that
 * cannot be transcribed is a support ticket.
 */
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
const PASSWORD_LENGTH = 20;

function generatePassword(): string {
  const bytes = randomBytes(PASSWORD_LENGTH * 2);
  let out = '';
  for (let i = 0; out.length < PASSWORD_LENGTH && i < bytes.length; i += 1) {
    // Rejection sampling keeps every character equally likely; a plain modulo
    // would bias toward the front of the alphabet.
    const value = bytes[i]!;
    if (value >= 256 - (256 % ALPHABET.length)) continue;
    out += ALPHABET[value % ALPHABET.length];
  }
  if (out.length < PASSWORD_LENGTH) return generatePassword();
  return out;
}

function generateUsername(tradingAccountId: string): string {
  const suffix = createHash('sha256').update(tradingAccountId).digest('hex').slice(0, 8).toUpperCase();
  return `BRF-${suffix}`;
}

export interface IssuedCredential {
  readonly username: string;
  /** Returned exactly once, at issue time. Never read back from storage. */
  readonly password: string;
}

/**
 * Issue credentials for a newly provisioned account.
 *
 * Idempotent: an account that already has credentials keeps them, and the
 * existing username is returned with no password, because the password is not
 * ours to hand back a second time.
 */
export async function issueCredential(
  tradingAccountId: string,
  tx: Tx | typeof prisma = prisma,
): Promise<IssuedCredential | { username: string; password: null }> {
  const existing = await tx.platformCredential.findUnique({ where: { tradingAccountId } });
  if (existing) return { username: existing.username, password: null };

  const username = generateUsername(tradingAccountId);
  const password = generatePassword();
  const hashed = await hashPassword(password);
  const sealed = encrypt(password);

  await tx.platformCredential.create({
    data: {
      tradingAccountId,
      username,
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordParams: hashed.params,
      initialSecretCipher: sealed.cipher,
      initialSecretIv: sealed.iv,
      initialSecretTag: sealed.tag,
      mustChangeOnFirstUse: true,
    },
  });

  return { username, password };
}

export interface CredentialView {
  readonly username: string;
  /** Present only until the trader confirms they have saved it. */
  readonly password: string | null;
  readonly acknowledged: boolean;
  readonly mustChangeOnFirstUse: boolean;
  readonly reissueCount: number;
  readonly lastIssuedAt: string;
}

/** Read credentials for display. Verifies the account belongs to the caller. */
export async function getCredentialForUser(
  userId: string,
  tradingAccountId: string,
): Promise<CredentialView | null> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: tradingAccountId },
    select: { userId: true },
  });
  // Object-level authorisation: an account id is not authority to see its
  // credentials.
  if (!account || account.userId !== userId) return null;

  const credential = await prisma.platformCredential.findUnique({ where: { tradingAccountId } });
  if (!credential || credential.revokedAt) return null;

  let password: string | null = null;
  if (
    !credential.acknowledgedAt &&
    credential.initialSecretCipher &&
    credential.initialSecretIv &&
    credential.initialSecretTag
  ) {
    try {
      password = decrypt(
        credential.initialSecretCipher,
        credential.initialSecretIv,
        credential.initialSecretTag,
      );
    } catch {
      // A key rotation makes old ciphertext undecryptable. That is not an
      // error state for the trader — it just means re-issue is the way back.
      password = null;
    }
  }

  return {
    username: credential.username,
    password,
    acknowledged: Boolean(credential.acknowledgedAt),
    mustChangeOnFirstUse: credential.mustChangeOnFirstUse,
    reissueCount: credential.reissueCount,
    lastIssuedAt: credential.lastIssuedAt.toISOString(),
  };
}

/** Confirm the trader has saved the password, and destroy the ciphertext. */
export async function acknowledgeCredential(
  userId: string,
  tradingAccountId: string,
): Promise<{ ok: boolean }> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: tradingAccountId },
    select: { userId: true },
  });
  if (!account || account.userId !== userId) return { ok: false };

  await prisma.platformCredential.updateMany({
    where: { tradingAccountId, acknowledgedAt: null },
    data: {
      acknowledgedAt: new Date(),
      // From here the password exists only as a hash.
      initialSecretCipher: null,
      initialSecretIv: null,
      initialSecretTag: null,
    },
  });
  return { ok: true };
}

/**
 * Re-issue a password.
 *
 * Rotation, not recovery: the old password stops working. The new one is
 * readable once, exactly like the first.
 */
export async function reissueCredential(
  userId: string,
  tradingAccountId: string,
): Promise<IssuedCredential | null> {
  const account = await prisma.tradingAccount.findUnique({
    where: { id: tradingAccountId },
    select: { userId: true },
  });
  if (!account || account.userId !== userId) return null;

  const credential = await prisma.platformCredential.findUnique({ where: { tradingAccountId } });
  if (!credential || credential.revokedAt) return null;

  const password = generatePassword();
  const hashed = await hashPassword(password);
  const sealed = encrypt(password);

  await prisma.platformCredential.update({
    where: { tradingAccountId },
    data: {
      passwordHash: hashed.hash,
      passwordSalt: hashed.salt,
      passwordParams: hashed.params,
      initialSecretCipher: sealed.cipher,
      initialSecretIv: sealed.iv,
      initialSecretTag: sealed.tag,
      acknowledgedAt: null,
      mustChangeOnFirstUse: true,
      reissueCount: { increment: 1 },
      lastIssuedAt: new Date(),
    },
  });

  await recordAudit({
    actorId: userId,
    actorLabel: userId,
    action: 'CREDENTIAL_REISSUED',
    entityType: 'PlatformCredential',
    entityId: credential.id,
    after: { reissueCount: credential.reissueCount + 1 },
  });

  return { username: credential.username, password };
}

/** Used by the platform adapter to check a presented password. */
export async function verifyCredential(
  username: string,
  password: string,
): Promise<{ valid: boolean; tradingAccountId: string | null }> {
  const credential = await prisma.platformCredential.findUnique({ where: { username } });
  if (!credential || credential.revokedAt) return { valid: false, tradingAccountId: null };

  const result = await verifyPassword(password, {
    hash: credential.passwordHash,
    salt: credential.passwordSalt,
    params: credential.passwordParams,
  });
  return {
    valid: result.valid,
    tradingAccountId: result.valid ? credential.tradingAccountId : null,
  };
}
