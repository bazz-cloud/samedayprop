/**
 * Ledger persistence.
 *
 * Entries are validated in the domain layer, then written here inside the same
 * transaction as the state change that caused them. The unique idempotency key
 * means a retried job re-posts nothing: the second attempt sees the conflict
 * and returns the existing entry.
 */

import type { Prisma } from '@/generated/prisma';
import { prisma } from '@/server/db';
import { validateEntry, type LedgerEntryDraft } from '@/domain/ledger/entries';
import { Money } from '@/domain/money/money';
import type { AccountCode, LedgerName } from '@/domain/ledger/accounts';

type Tx = Prisma.TransactionClient;

export async function postEntry(
  entry: LedgerEntryDraft,
  tx: Tx | typeof prisma = prisma,
): Promise<{ id: string; created: boolean }> {
  validateEntry(entry);

  const existing = await tx.ledgerEntry.findUnique({
    where: { idempotencyKey: entry.idempotencyKey },
    select: { id: true },
  });
  if (existing) return { id: existing.id, created: false };

  try {
    const created = await tx.ledgerEntry.create({
      data: {
        ledger: entry.ledger,
        reason: entry.reason,
        actor: entry.actor,
        policyVersion: entry.policyVersion,
        idempotencyKey: entry.idempotencyKey,
        references: JSON.stringify(entry.references),
        compensatesEntryId: entry.compensatesEntryId ?? null,
        lines: {
          create: entry.lines.map((line) => ({
            account: line.account,
            debitMinor: line.debit.minor,
            creditMinor: line.credit.minor,
          })),
        },
      },
      select: { id: true },
    });
    return { id: created.id, created: true };
  } catch (error) {
    // Lost a race on the unique key: the other writer posted it, which is the
    // correct outcome. Return theirs rather than failing the operation.
    const raced = await tx.ledgerEntry.findUnique({
      where: { idempotencyKey: entry.idempotencyKey },
      select: { id: true },
    });
    if (raced) return { id: raced.id, created: false };
    throw error;
  }
}

export async function postEntries(
  entries: readonly LedgerEntryDraft[],
  tx: Tx | typeof prisma = prisma,
): Promise<{ id: string; created: boolean }[]> {
  const results: { id: string; created: boolean }[] = [];
  for (const entry of entries) {
    results.push(await postEntry(entry, tx));
  }
  return results;
}

export interface AccountBalance {
  readonly account: AccountCode;
  readonly ledger: LedgerName;
  readonly debits: Money;
  readonly credits: Money;
  /** Debits minus credits. Interpret against the account's normal balance. */
  readonly net: Money;
}

export async function accountBalances(ledger?: LedgerName): Promise<AccountBalance[]> {
  const lines = await prisma.ledgerLine.findMany({
    where: ledger ? { entry: { ledger } } : undefined,
    select: {
      account: true,
      debitMinor: true,
      creditMinor: true,
      entry: { select: { ledger: true } },
    },
  });

  const totals = new Map<string, { ledger: string; debits: bigint; credits: bigint }>();
  for (const line of lines) {
    const current = totals.get(line.account) ?? {
      ledger: line.entry.ledger,
      debits: 0n,
      credits: 0n,
    };
    current.debits += line.debitMinor;
    current.credits += line.creditMinor;
    totals.set(line.account, current);
  }

  return [...totals.entries()]
    .map(([account, t]) => ({
      account: account as AccountCode,
      ledger: t.ledger as LedgerName,
      debits: Money.fromMinor(t.debits),
      credits: Money.fromMinor(t.credits),
      net: Money.fromMinor(t.debits - t.credits),
    }))
    .sort((a, b) => a.account.localeCompare(b.account));
}

/**
 * Every ledger must balance to zero across all of its accounts.
 *
 * Run on a schedule and surfaced in the admin console; a non-zero result means
 * an entry was written outside `postEntry` or the database was edited by hand.
 */
export async function verifyLedgersBalance(): Promise<
  { ledger: LedgerName; balanced: boolean; net: Money }[]
> {
  const ledgers: LedgerName[] = ['SIMULATION', 'CASH', 'OBLIGATION', 'REVENUE'];
  const results: { ledger: LedgerName; balanced: boolean; net: Money }[] = [];

  for (const ledger of ledgers) {
    const balances = await accountBalances(ledger);
    const net = Money.sum(balances.map((b) => b.net));
    results.push({ ledger, balanced: net.isZero(), net });
  }
  return results;
}
