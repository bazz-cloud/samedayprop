/**
 * Background worker loop.
 *
 * Polls for runnable jobs, claims one at a time and runs it. A handler failure
 * is retried with exponential backoff until maxAttempts, then the job is marked
 * DEAD and surfaced in the admin console rather than retried forever.
 */

import { claimNextJob, completeJob, failJob, newWorkerId, recoverStaleClaims } from './queue';
import { runJob } from './handlers';

export interface WorkerOptions {
  readonly pollIntervalMs?: number;
  readonly workerId?: string;
  readonly onLog?: (message: string) => void;
}

export interface WorkerHandle {
  stop(): Promise<void>;
}

export async function drainOnce(workerId = newWorkerId(), onLog?: (m: string) => void): Promise<number> {
  let processed = 0;
  for (;;) {
    const job = await claimNextJob(workerId);
    if (!job) break;

    try {
      const result = await runJob(job);
      await completeJob(job.id);
      onLog?.(`[${job.kind}] ${result}`);
    } catch (error) {
      const retryable = (error as Error & { retryable?: boolean }).retryable !== false;
      const { dead } = await failJob(job.id, error, retryable);
      onLog?.(
        `[${job.kind}] ${dead ? 'DEAD' : 'retrying'}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
    processed += 1;

    // Bound one drain so a permanently-failing job cannot spin the loop.
    if (processed > 500) break;
  }
  return processed;
}

export function startWorker(options: WorkerOptions = {}): WorkerHandle {
  const workerId = options.workerId ?? newWorkerId();
  const interval = options.pollIntervalMs ?? 1000;
  let stopped = false;
  let timer: NodeJS.Timeout | null = null;

  const tick = async (): Promise<void> => {
    if (stopped) return;
    try {
      await recoverStaleClaims();
      await drainOnce(workerId, options.onLog);
    } catch (error) {
      options.onLog?.(`worker error: ${error instanceof Error ? error.message : String(error)}`);
    }
    if (!stopped) timer = setTimeout(() => void tick(), interval);
  };

  void tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
    },
  };
}
