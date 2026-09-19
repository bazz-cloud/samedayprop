/**
 * Align the Prisma datasource provider with DATABASE_URL.
 *
 * Prisma requires the provider to be a literal in the schema — it cannot be
 * read from an environment variable. That leaves a choice between a schema that
 * runs locally with zero setup (SQLite) and one that deploys (PostgreSQL).
 *
 * This picks the right one from the URL scheme at build time, so `file:./dev.db`
 * keeps local development dependency-free and a `postgres://` URL on a host
 * gets a Postgres schema without anyone editing a file by hand.
 *
 * Run before `prisma generate`.
 */
import { readFile, writeFile } from 'node:fs/promises';

const SCHEMA = 'prisma/schema.prisma';
const url = process.env.DATABASE_URL ?? '';

// Prisma Postgres (the Vercel marketplace integration) hands out a
// `prisma+postgres://` Accelerate URL, not a TCP Postgres connection string.
// It needs the Accelerate driver adapter, which this application does not use,
// and it would otherwise fall through to sqlite here and produce a deployment
// that builds cleanly and cannot write a single row.
if (/^prisma\+postgres:\/\//i.test(url)) {
  console.error(
    '\n  DATABASE_URL is a Prisma Accelerate URL (prisma+postgres://).\n' +
      '  This application connects over plain Postgres and has no Accelerate adapter,\n' +
      '  so this URL cannot work. Use a database that gives a postgres:// connection\n' +
      '  string (Neon and Vercel Postgres both do), or supply the direct connection\n' +
      '  string from the Prisma console instead of the Accelerate one.\n',
  );
  process.exit(1);
}

const provider = /^postgres(ql)?:\/\//i.test(url)
  ? 'postgresql'
  : /^mysql:\/\//i.test(url)
    ? 'mysql'
    : 'sqlite';

const schema = await readFile(SCHEMA, 'utf8');
const updated = schema.replace(
  /(datasource db \{\s*\n\s*provider\s*=\s*")[^"]+(")/,
  `$1${provider}$2`,
);

if (updated === schema) {
  console.log(`prisma datasource provider already ${provider}`);
} else {
  await writeFile(SCHEMA, updated, 'utf8');
  console.log(`prisma datasource provider set to ${provider} (from DATABASE_URL)`);
}

// A warning here would let the build succeed and the site go live unable to
// persist anything: serverless filesystems are ephemeral and read-only at
// runtime, so every order, session and payout request would vanish or error.
// Better to fail the build while someone is watching it.
if (provider === 'sqlite' && process.env.VERCEL) {
  console.error(
    `\n  Refusing to build on Vercel with ${url ? 'a SQLite' : 'no'} DATABASE_URL.\n` +
      '  Serverless filesystems are ephemeral and read-only at runtime, so the deployment\n' +
      '  would build cleanly and then fail every write.\n' +
      '  Attach a Postgres database (Storage -> Neon or Vercel Postgres) and redeploy.\n',
  );
  process.exit(1);
}
