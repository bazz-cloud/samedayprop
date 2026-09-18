/**
 * Basic CSV export.
 *
 * Deliberately available to every account with no add-on required: the brief is
 * explicit that basic financial exports must not sit behind a premium analytics
 * purchase.
 */

import { prisma } from '@/server/db';
import { requireUser } from '@/server/auth/session';
import { Money } from '@/domain/money/money';

function csvEscape(value: string): string {
  // A leading =, +, - or @ is treated as a formula by spreadsheet software, so
  // prefix it to prevent CSV injection when the file is opened.
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replaceAll('"', '""')}"`;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const account = await prisma.tradingAccount.findUnique({ where: { id } });
  if (!account || account.userId !== user.id) {
    return new Response('Not found', { status: 404 });
  }

  const [checkpoints, payouts, events] = await Promise.all([
    prisma.equityCheckpoint.findMany({
      where: { tradingAccountId: id },
      orderBy: { observedAt: 'asc' },
      take: 5000,
    }),
    prisma.payoutRequest.findMany({
      where: { tradingAccountId: id },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.riskEvent.findMany({
      where: { tradingAccountId: id },
      orderBy: { occurredAt: 'asc' },
    }),
  ]);

  const rows: string[] = [];
  rows.push(
    ['record_type', 'timestamp', 'session_date', 'field_a', 'field_b', 'field_c', 'detail']
      .map(csvEscape)
      .join(','),
  );

  for (const checkpoint of checkpoints) {
    rows.push(
      [
        'equity_checkpoint',
        checkpoint.observedAt.toISOString(),
        checkpoint.sessionDate,
        Money.fromMinor(checkpoint.equityMinor).toDecimalString(),
        Money.fromMinor(checkpoint.thresholdMinor).toDecimalString(),
        Money.fromMinor(checkpoint.commissionsMinor).toDecimalString(),
        'equity, trailing threshold, commissions (simulated units)',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  for (const payout of payouts) {
    rows.push(
      [
        'payout_request',
        payout.createdAt.toISOString(),
        payout.sessionDate,
        Money.fromMinor(payout.grossMinor).toDecimalString(),
        Money.fromMinor(payout.cashMinor).toDecimalString(),
        payout.state,
        'gross (simulated deduction), cash (real payment), state',
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  for (const event of events) {
    rows.push(
      [
        'risk_event',
        event.occurredAt.toISOString(),
        event.sessionDate ?? '',
        event.eventType,
        event.severity,
        String(event.actionConfirmed ?? ''),
        event.reason,
      ]
        .map(csvEscape)
        .join(','),
    );
  }

  return new Response(rows.join('\n'), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="account-${id}.csv"`,
      // Never cached by a shared proxy: this is per-customer financial data.
      'Cache-Control': 'private, no-store',
    },
  });
}
