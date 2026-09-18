/**
 * Account provisioning.
 *
 * Drives payment_pending -> paid -> provisioning -> provisioned_unverified ->
 * risk_verified -> active, with bounded retries and a manual-review terminus.
 *
 * The rule that matters most: an account becomes ACTIVE only after the provider
 * has confirmed, by READ-BACK, that the risk limits are actually in place.
 * "The configureRisk call did not throw" is not confirmation. If the read-back
 * disagrees or is unavailable, the account stays unverified and a human is
 * paged, because a tradeable account with unenforced limits is an uncapped
 * liability.
 */

import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';
import { Money } from '@/domain/money/money';
import { ceilingToMicroEquivalents } from '@/domain/risk/exposure';
import {
  assertTransition,
  nextStateAfterFailure,
  type ProvisioningState,
} from '@/domain/provisioning/state-machine';
import { computeThreshold } from '@/domain/risk/trailing';
import { getTradingProvider } from '@/server/providers/registry';
import { requireCapability } from '@/server/providers/trading/types';
import { toRuleSnapshot } from './catalog-service';
import { recordAudit } from './audit-service';
import { issueCredential } from './credential-service';
import { enqueueJob } from '@/server/jobs/queue';

type Tx = Prisma.TransactionClient;

async function transition(
  jobId: string,
  to: ProvisioningState,
  data: Prisma.ProvisioningJobUpdateInput = {},
  tx: Tx | typeof prisma = prisma,
): Promise<void> {
  const job = await tx.provisioningJob.findUniqueOrThrow({ where: { id: jobId } });
  assertTransition(job.state as ProvisioningState, to);
  await tx.provisioningJob.update({ where: { id: jobId }, data: { ...data, state: to } });

  // Keep the trading account's mirrored state in step, when one exists.
  await tx.tradingAccount.updateMany({
    where: { orderId: job.orderId },
    data: { provisioningState: to },
  });
}

export interface ProvisionOutcome {
  readonly state: ProvisioningState;
  readonly tradingAccountId: string | null;
  readonly detail: string;
}

export async function runProvisioning(orderId: string): Promise<ProvisionOutcome> {
  const job = await prisma.provisioningJob.findFirst({ where: { orderId } });
  if (!job) throw new Error(`No provisioning job for order ${orderId}`);

  const order = await prisma.order.findUniqueOrThrow({
    where: { id: orderId },
    include: { user: true, planVersion: true },
  });

  if (order.status !== 'PAID' && order.status !== 'FULFILLED') {
    return {
      state: job.state as ProvisioningState,
      tradingAccountId: null,
      detail: 'Order is not paid; provisioning has not started.',
    };
  }

  const provider = getTradingProvider();
  const rules = toRuleSnapshot(order.planVersion);

  // ---- 1. Create the external account -------------------------------------
  let account = await prisma.tradingAccount.findUnique({ where: { orderId } });

  if (!account) {
    // Move into `provisioning` from whichever waiting state we are in. A retry
    // arrives here in `provisioning_failed_retryable` (or `manual_review` after
    // an operator re-queues it), and without this step the success and failure
    // transitions below would both be illegal from that state.
    if (job.state === 'paid' || job.state === 'provisioning_failed_retryable' || job.state === 'manual_review') {
      await transition(job.id, 'provisioning', { attempts: { increment: 1 } });
    }

    try {
      requireCapability(
        provider,
        'provisionSimulatedAccount',
        'Account provisioning cannot proceed.',
      );

      const result = await provider.provisionAccount({
        orderId,
        userId: order.userId,
        email: order.user.email,
        legalName: order.user.legalName ?? order.user.email,
        planKey: rules.planKey,
        startingBalance: rules.startingBalance,
        // The same key every attempt: a retry returns the SAME external
        // account rather than creating a second one.
        idempotencyKey: `provision:${orderId}`,
      });

      const threshold = computeThreshold(
        {
          startingBalance: rules.startingBalance,
          drawdownAllowance: rules.drawdownAllowance,
          stopOffset: rules.trailingStopOffset,
        },
        rules.startingBalance,
      );

      account = await prisma.tradingAccount.create({
        data: {
          userId: order.userId,
          orderId,
          planVersionId: order.planVersionId,
          externalAccountId: result.externalAccountId,
          providerName: provider.name,
          providerMode: provider.mode,
          provisioningState: 'provisioned_unverified',
          tradingStatus: 'PENDING',
          startingBalanceMinor: rules.startingBalance.minor,
          balanceMinor: rules.startingBalance.minor,
          equityMinor: rules.startingBalance.minor,
          highWaterMinor: rules.startingBalance.minor,
          thresholdMinor: threshold.minor,
          // Nothing authoritative has arrived yet, so the account starts stale.
          dataStale: true,
        },
      });

      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { externalJobRef: result.externalJobRef },
      });
      await transition(job.id, 'provisioned_unverified');
    } catch (error) {
      const retryable = (error as Error & { retryable?: boolean }).retryable !== false;
      const nextState = nextStateAfterFailure(job.attempts + 1, retryable);
      await transition(job.id, nextState, {
        lastError: error instanceof Error ? error.message : String(error),
        retryable,
        nextAttemptAt: new Date(Date.now() + 30_000),
      });

      if (nextState === 'provisioning_failed_retryable') {
        await enqueueJob({
          kind: 'PROVISION_ACCOUNT',
          payload: { orderId },
          idempotencyKey: `provision-retry:${orderId}:${job.attempts + 1}`,
          runAfter: new Date(Date.now() + 30_000),
        });
      }

      return {
        state: nextState,
        tradingAccountId: null,
        detail:
          'Provisioning did not complete. The payment is recorded and no account has been ' +
          'created. This is visible to the customer as a pending state.',
      };
    }
  }

  // ---- 2. Configure and VERIFY risk ---------------------------------------
  const current = await prisma.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });

  if (current.state === 'provisioned_unverified') {
    try {
      requireCapability(provider, 'configureRisk', 'Risk limits cannot be applied.');

      const products = await prisma.productRiskConfig.findMany({ where: { approved: true } });
      const verification = await provider.configureRisk(account.externalAccountId!, {
        maxMicroEquivalents: ceilingToMicroEquivalents({
          minis: rules.ceilingMinis,
          micros: rules.ceilingMicros,
        }),
        dailyLossLimit: rules.dailyLossLimit,
        trailingThreshold: Money.fromMinor(account.thresholdMinor),
        allowedSymbols: products.map((p) => p.symbol),
      });

      await prisma.provisioningJob.update({
        where: { id: job.id },
        data: { riskVerification: verification.evidence },
      });

      if (!verification.verified) {
        // The account exists but its limits are not confirmed. It does NOT go
        // active; a person has to look at it.
        await transition(job.id, 'manual_review', {
          lastError: `Risk configuration could not be verified: ${verification.mismatches.join('; ')}`,
        });
        await prisma.riskEvent.create({
          data: {
            tradingAccountId: account.id,
            eventType: 'TRADING_DISABLE_FAILED',
            severity: 'CRITICAL',
            reason:
              'Risk limits were sent to the provider but could not be read back and confirmed. ' +
              'Trading has not been enabled.',
            evidence: verification.evidence,
            requestedAction: 'configureRisk',
            actionConfirmed: false,
          },
        });
        return {
          state: 'manual_review',
          tradingAccountId: account.id,
          detail: 'Risk configuration unverified; account held for review.',
        };
      }

      await transition(job.id, 'risk_verified');
    } catch (error) {
      await transition(job.id, 'manual_review', {
        lastError: error instanceof Error ? error.message : String(error),
      });
      return {
        state: 'manual_review',
        tradingAccountId: account.id,
        detail: 'Risk configuration failed; account held for review.',
      };
    }
  }

  // ---- 3. Activate ---------------------------------------------------------
  const afterRisk = await prisma.provisioningJob.findUniqueOrThrow({ where: { id: job.id } });
  if (afterRisk.state === 'risk_verified') {
    await transition(job.id, 'active');
    await prisma.tradingAccount.update({
      where: { id: account.id },
      data: { tradingStatus: 'ACTIVE', statusReason: null },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: 'FULFILLED' } });

    // Credentials are issued only once the account is genuinely tradeable, so a
    // trader never holds a sign-in for an account that does not exist yet.
    await issueCredential(account.id);

    await recordAudit({
      actorId: null,
      actorLabel: 'system',
      action: 'ACCOUNT_ACTIVATED',
      entityType: 'TradingAccount',
      entityId: account.id,
      after: { externalAccountId: account.externalAccountId },
    });

    await enqueueJob({
      kind: 'SYNC_ACCOUNT',
      payload: { tradingAccountId: account.id },
      idempotencyKey: `sync-initial:${account.id}`,
    });

    return {
      state: 'active',
      tradingAccountId: account.id,
      detail: 'Account provisioned and risk limits verified.',
    };
  }

  return {
    state: afterRisk.state as ProvisioningState,
    tradingAccountId: account.id,
    detail: 'Provisioning in progress.',
  };
}
