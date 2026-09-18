/**
 * Job handlers.
 *
 * Each handler is idempotent: the queue guarantees at-least-once delivery, so a
 * handler that runs twice must produce the same result as running once.
 */

import { prisma } from '@/server/db';
import { runProvisioning } from '@/server/services/provisioning-service';
import { syncAccount } from '@/server/services/risk-service';
import { submitPayout, validateAndApprove } from '@/server/services/payout-service';
import { verifyLedgersBalance } from '@/server/services/ledger-service';
import { getEmailProvider } from '@/server/providers/email/outbox';
import type { ClaimedJob, JobKind } from './queue';

export type JobHandler = (payload: Record<string, unknown>) => Promise<string>;

function requireString(payload: Record<string, unknown>, key: string): string {
  const value = payload[key];
  if (typeof value !== 'string' || !value) {
    throw new Error(`Job payload is missing ${key}`);
  }
  return value;
}

export const HANDLERS: Record<JobKind, JobHandler> = {
  PROVISION_ACCOUNT: async (payload) => {
    const outcome = await runProvisioning(requireString(payload, 'orderId'));
    return `provisioning -> ${outcome.state}: ${outcome.detail}`;
  },

  VERIFY_RISK_CONFIG: async (payload) => {
    const outcome = await runProvisioning(requireString(payload, 'orderId'));
    return `risk verification -> ${outcome.state}`;
  },

  SYNC_ACCOUNT: async (payload) => {
    const assessment = await syncAccount(requireString(payload, 'tradingAccountId'));
    if (!assessment) return 'account data unavailable; marked stale';
    return (
      `equity ${assessment.equity.toDecimalString()}, threshold ` +
      `${assessment.threshold.toDecimalString()}, breaches [${assessment.breaches.join(',')}]`
    );
  },

  SUBMIT_PAYOUT: async (payload) => {
    const payoutRequestId = requireString(payload, 'payoutRequestId');
    const stage = typeof payload.stage === 'string' ? payload.stage : 'validate';
    const state =
      stage === 'submit'
        ? await submitPayout(payoutRequestId)
        : await validateAndApprove(payoutRequestId);
    return `payout ${payoutRequestId} -> ${state}`;
  },

  RECONCILE_PAYOUT: async (payload) => {
    const payoutRequestId = requireString(payload, 'payoutRequestId');
    const request = await prisma.payoutRequest.findUnique({ where: { id: payoutRequestId } });
    if (!request) return 'payout request no longer exists';

    // Without a verified payout rail there is nothing authoritative to ask, so
    // the request stays parked. Inventing an outcome here is exactly the
    // failure this state exists to prevent.
    return (
      `payout ${payoutRequestId} remains in ${request.state}; no verified payout rail is ` +
      'configured to confirm the outcome. Operator action required.'
    );
  },

  RECONCILE_PROVIDER_BALANCES: async () => {
    const run = await prisma.reconciliationRun.create({
      data: { kind: 'PROVIDER_BALANCES', status: 'RUNNING' },
    });

    const accounts = await prisma.tradingAccount.findMany({
      where: { tradingStatus: { in: ['ACTIVE', 'DAILY_PAUSED'] } },
      select: { id: true },
    });

    const findings: string[] = [];
    for (const account of accounts) {
      const assessment = await syncAccount(account.id);
      if (!assessment) findings.push(`${account.id}: provider data unavailable`);
    }

    const ledgers = await verifyLedgersBalance();
    for (const ledger of ledgers) {
      if (!ledger.balanced) {
        findings.push(`${ledger.ledger} ledger is out of balance by ${ledger.net.toDecimalString()}`);
      }
    }

    await prisma.reconciliationRun.update({
      where: { id: run.id },
      data: {
        status: findings.length === 0 ? 'CLEAN' : 'MISMATCH',
        finishedAt: new Date(),
        checkedCount: accounts.length + ledgers.length,
        mismatchCount: findings.length,
        findings: findings.length > 0 ? JSON.stringify(findings) : null,
      },
    });

    return `reconciled ${accounts.length} accounts, ${findings.length} findings`;
  },

  SEND_EMAIL: async (payload) => {
    const provider = getEmailProvider();
    const result = await provider.send({
      to: requireString(payload, 'to'),
      subject: requireString(payload, 'subject'),
      bodyText: requireString(payload, 'bodyText'),
    });
    return `email ${result.status} (${provider.name})`;
  },

  ROLL_TRADING_SESSION: async () => {
    // A daily lockout lifts at the Globex reopen, which is an hour after the
    // session roll — so this resumes only the accounts whose lockout has
    // actually expired, not every paused account. A max drawdown breach never
    // lifts here; that account is terminated and needs a paid reset.
    const now = new Date();
    const due = await prisma.tradingAccount.findMany({
      where: { tradingStatus: 'DAILY_PAUSED', lockedOutUntil: { lte: now } },
      select: { id: true },
    });
    if (due.length > 0) {
      await prisma.tradingAccount.updateMany({
        where: { id: { in: due.map((a) => a.id) } },
        data: { tradingStatus: 'ACTIVE', statusReason: null, lockedOutUntil: null },
      });
    }
    const stillLocked = await prisma.tradingAccount.count({
      where: { tradingStatus: 'DAILY_PAUSED', lockedOutUntil: { gt: now } },
    });
    return `resumed ${due.length} accounts, ${stillLocked} still locked until the reopen`;
  },
};

export async function runJob(job: ClaimedJob): Promise<string> {
  const handler = HANDLERS[job.kind];
  if (!handler) throw new Error(`No handler for job kind ${job.kind}`);
  return handler(job.payload);
}
