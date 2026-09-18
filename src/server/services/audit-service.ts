/**
 * Administrative audit trail.
 *
 * Money-moving and rule-changing actions require a stated reason. The check is
 * here rather than in each call site so it cannot be forgotten in one of them.
 */

import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';

type Tx = Prisma.TransactionClient;

/** Actions that may not be recorded without a human-written reason. */
const REASON_REQUIRED = new Set([
  'MANUAL_BALANCE_ADJUSTMENT',
  'PAYOUT_APPROVED',
  'PAYOUT_REJECTED',
  'PAYOUT_FORCE_PAID',
  'REFUND_ISSUED',
  'PLAN_VERSION_PUBLISHED',
  'LIFETIME_CAP_APPROVED',
  'TRADING_DISABLED',
  'ACCOUNT_BREACH_OVERRIDDEN',
  'SALES_PAUSED',
  'LAUNCH_GATE_CHANGED',
]);

export interface AuditInput {
  readonly actorId: string | null;
  readonly actorLabel: string;
  readonly action: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly reason?: string;
  readonly before?: unknown;
  readonly after?: unknown;
  readonly ipAddress?: string;
}

export async function recordAudit(
  input: AuditInput,
  tx: Tx | typeof prisma = prisma,
): Promise<string> {
  if (REASON_REQUIRED.has(input.action) && !input.reason?.trim()) {
    throw new Error(`Action ${input.action} requires a stated reason`);
  }

  const created = await tx.auditEvent.create({
    data: {
      actorId: input.actorId,
      actorLabel: input.actorLabel,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      reason: input.reason ?? null,
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      ipAddress: input.ipAddress ?? null,
    },
    select: { id: true },
  });
  return created.id;
}

/** Actions large enough to need a second approver. */
const DUAL_APPROVAL_ACTIONS = new Set([
  'MANUAL_BALANCE_ADJUSTMENT',
  'PAYOUT_FORCE_PAID',
  'LIFETIME_CAP_APPROVED',
  'LAUNCH_GATE_CHANGED',
]);

export function requiresDualApproval(action: string): boolean {
  return DUAL_APPROVAL_ACTIONS.has(action);
}

export async function requestDualApproval(input: {
  action: string;
  entityType: string;
  entityId: string;
  requestedBy: string;
  reason: string;
}): Promise<{ id: string }> {
  if (!input.reason.trim()) {
    throw new Error('A dual-approval request requires a stated reason');
  }
  return prisma.dualApproval.create({
    data: {
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      requestedBy: input.requestedBy,
      reason: input.reason,
      status: 'PENDING',
    },
    select: { id: true },
  });
}

export async function approveDualApproval(
  id: string,
  approvedBy: string,
): Promise<{ ok: boolean; message: string }> {
  const record = await prisma.dualApproval.findUnique({ where: { id } });
  if (!record) return { ok: false, message: 'Approval request not found.' };
  if (record.status !== 'PENDING') {
    return { ok: false, message: `Request is already ${record.status}.` };
  }
  if (record.requestedBy === approvedBy) {
    // The whole point of dual approval.
    return { ok: false, message: 'A second person must approve this action.' };
  }

  await prisma.dualApproval.update({
    where: { id },
    data: { status: 'APPROVED', approvedBy, approvedAt: new Date() },
  });
  return { ok: true, message: 'Approved.' };
}
