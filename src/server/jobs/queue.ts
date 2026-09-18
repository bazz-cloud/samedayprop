/**
 * Durable job queue backed by the database.
 *
 * External work (provisioning an account, submitting a payout, sending mail)
 * cannot join a database transaction. So the transaction writes a JOB ROW and
 * commits; a worker picks it up afterwards. If the process dies between the two,
 * the job is still in the table and runs on the next poll — nothing is lost
 * because it only lived in memory.
 *
 * Claiming uses a conditional update, so two workers racing for the same row
 * produce exactly one winner without a distributed lock.
 */

import { randomUUID } from 'node:crypto';
import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';

type Tx = Prisma.TransactionClient;

export type JobKind =
  | 'PROVISION_ACCOUNT'
  | 'VERIFY_RISK_CONFIG'
  | 'SYNC_ACCOUNT'
  | 'SUBMIT_PAYOUT'
  | 'RECONCILE_PAYOUT'
  | 'RECONCILE_PROVIDER_BALANCES'
  | 'SEND_EMAIL'
  | 'ROLL_TRADING_SESSION';

export interface EnqueueInput {
  readonly kind: JobKind;
  readonly payload: Record<string, unknown>;
  /** Enqueuing the same logical job twice is a no-op. */
  readonly idempotencyKey: string;
  readonly runAfter?: Date;
  readonly maxAttempts?: number;
}

export async function enqueueJob(
  input: EnqueueInput,
  tx: Tx | typeof prisma = prisma,
): Promise<{ id: string; created: boolean }> {
  const existing = await tx.job.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  try {
    const job = await tx.job.create({
      data: {
        kind: input.kind,
        payload: JSON.stringify(input.payload),
        idempotencyKey: input.idempotencyKey,
        runAfter: input.runAfter ?? new Date(),
        maxAttempts: input.maxAttempts ?? 5,
      },
      select: { id: true },
    });
    return { id: job.id, created: true };
  } catch {
    const raced = await tx.job.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (raced) return { id: raced.id, created: false };
    throw new Error(`Failed to enqueue job ${input.kind}`);
  }
}

export interface ClaimedJob {
  readonly id: string;
  readonly kind: JobKind;
  readonly payload: Record<string, unknown>;
  readonly attempts: number;
  readonly maxAttempts: number;
}

/** Atomically claim one runnable job, or return null. */
export async function claimNextJob(workerId: string): Promise<ClaimedJob | null> {
  const candidate = await prisma.job.findFirst({
    where: { status: 'PENDING', runAfter: { lte: new Date() } },
    orderBy: { runAfter: 'asc' },
    select: { id: true },
  });
  if (!candidate) return null;

  // Conditional update: only the worker that flips PENDING -> CLAIMED wins.
  const claimed = await prisma.job.updateMany({
    where: { id: candidate.id, status: 'PENDING' },
    data: { status: 'CLAIMED', claimedAt: new Date(), claimedBy: workerId },
  });
  if (claimed.count === 0) return null;

  const job = await prisma.job.findUniqueOrThrow({ where: { id: candidate.id } });
  return {
    id: job.id,
    kind: job.kind as JobKind,
    payload: JSON.parse(job.payload) as Record<string, unknown>,
    attempts: job.attempts,
    maxAttempts: job.maxAttempts,
  };
}

export async function completeJob(jobId: string): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { status: 'SUCCEEDED', lastError: null },
  });
}

/** Exponential backoff: 2s, 4s, 8s, 16s, 32s. */
export function backoffMs(attempts: number): number {
  return Math.min(2 ** (attempts + 1) * 1000, 60_000);
}

export async function failJob(
  jobId: string,
  error: unknown,
  retryable = true,
): Promise<{ dead: boolean }> {
  const job = await prisma.job.findUniqueOrThrow({ where: { id: jobId } });
  const attempts = job.attempts + 1;
  const message = error instanceof Error ? error.message : String(error);

  if (!retryable || attempts >= job.maxAttempts) {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'DEAD', attempts, lastError: message },
    });
    return { dead: true };
  }

  await prisma.job.update({
    where: { id: jobId },
    data: {
      status: 'PENDING',
      attempts,
      lastError: message,
      claimedAt: null,
      claimedBy: null,
      runAfter: new Date(Date.now() + backoffMs(attempts)),
    },
  });
  return { dead: false };
}

export function newWorkerId(): string {
  return `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
}

/** Reclaim jobs whose worker died mid-run. */
export async function recoverStaleClaims(olderThanMs = 5 * 60_000): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanMs);
  const result = await prisma.job.updateMany({
    where: { status: 'CLAIMED', claimedAt: { lt: cutoff } },
    data: { status: 'PENDING', claimedAt: null, claimedBy: null },
  });
  return result.count;
}
