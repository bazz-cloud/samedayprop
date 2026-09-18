/**
 * Worker process entry point: `npm run worker`.
 *
 * Runs alongside `npm run dev`. Provisioning, account syncing, payout
 * submission and reconciliation all happen here rather than inside a request,
 * so a customer's HTTP request never waits on an external provider.
 */

import { startWorker } from './worker';
import { enqueueJob } from './queue';
import { getConfig } from '@/server/config';

const config = getConfig();

console.log(`Worker starting in ${config.mode} mode.`);
console.log(
  `Providers — payments: ${config.providers.payments.driver}, ` +
    `trading: ${config.providers.trading.driver}, email: ${config.providers.email.driver}`,
);
if (config.isDemo) {
  console.log('DEMO MODE: no real money moves, no real email is sent, no real account is created.');
}

const handle = startWorker({
  pollIntervalMs: 1000,
  onLog: (message) => console.log(new Date().toISOString(), message),
});

// Periodic reconciliation. A fixed key per minute-bucket keeps this idempotent
// if several workers run.
const RECONCILE_INTERVAL_MS = 60_000;
const reconcileTimer = setInterval(() => {
  const bucket = Math.floor(Date.now() / RECONCILE_INTERVAL_MS);
  void enqueueJob({
    kind: 'RECONCILE_PROVIDER_BALANCES',
    payload: {},
    idempotencyKey: `reconcile:${bucket}`,
  }).catch((error: unknown) => console.error('failed to enqueue reconciliation', error));
}, RECONCILE_INTERVAL_MS);

async function shutdown(signal: string): Promise<void> {
  console.log(`\n${signal} received, stopping worker.`);
  clearInterval(reconcileTimer);
  await handle.stop();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
