/**
 * Email delivery.
 *
 * In DEMO mode nothing is sent. Messages are written to the EmailOutbox table
 * and (optionally) to a local .outbox directory, so a development database full
 * of seeded traders can never result in mail landing in a real inbox.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { prisma } from '@/server/db';
import { getConfig } from '@/server/config';

export interface OutgoingEmail {
  readonly to: string;
  readonly subject: string;
  readonly bodyText: string;
  readonly bodyHtml?: string;
  readonly attachments?: readonly { filename: string; description: string }[];
}

export interface EmailProvider {
  readonly name: string;
  readonly sendsRealEmail: boolean;
  send(email: OutgoingEmail): Promise<{ id: string; status: string }>;
}

export class LocalOutboxEmailProvider implements EmailProvider {
  readonly name = 'local-outbox';
  readonly sendsRealEmail = false;

  constructor(private readonly directory = '.outbox') {}

  async send(email: OutgoingEmail): Promise<{ id: string; status: string }> {
    const record = await prisma.emailOutbox.create({
      data: {
        toAddress: email.to,
        subject: email.subject,
        bodyText: email.bodyText,
        bodyHtml: email.bodyHtml ?? null,
        attachments: email.attachments ? JSON.stringify(email.attachments) : null,
        status: 'WRITTEN_LOCALLY',
        provider: this.name,
      },
    });

    try {
      await mkdir(this.directory, { recursive: true });
      await writeFile(
        join(this.directory, `${record.id}.txt`),
        [
          'THIS MESSAGE WAS NOT SENT. Demo mode writes to a local outbox.',
          `To: ${email.to}`,
          `Subject: ${email.subject}`,
          '',
          email.bodyText,
        ].join('\n'),
        'utf8',
      );
    } catch {
      // A read-only filesystem must not fail the business operation; the
      // database row is the authoritative record either way.
    }

    return { id: record.id, status: 'WRITTEN_LOCALLY' };
  }
}

/**
 * SMTP delivery is intentionally not implemented.
 *
 * Wiring a real transport before the company's own domain, sending identity and
 * legal contact details exist would mean sending mail that misidentifies the
 * sender. Configure SMTP_URL and implement this once those are supplied.
 */
export class UnconfiguredSmtpProvider implements EmailProvider {
  readonly name = 'smtp';
  readonly sendsRealEmail = true;

  async send(): Promise<{ id: string; status: string }> {
    throw new Error(
      'Real email delivery is not implemented. Supply the company sending identity and ' +
        'contact details, then implement the SMTP transport. Demo mode uses the local outbox.',
    );
  }
}

export function getEmailProvider(): EmailProvider {
  const config = getConfig();
  return config.providers.email.driver === 'smtp'
    ? new UnconfiguredSmtpProvider()
    : new LocalOutboxEmailProvider();
}
