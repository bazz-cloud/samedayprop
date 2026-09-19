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

if (provider === 'sqlite' && process.env.VERCEL) {
  console.warn(
    '\n  WARNING: building on Vercel with a SQLite DATABASE_URL.\n' +
      '  Vercel filesystems are ephemeral and read-only at runtime, so writes will fail.\n' +
      '  Set DATABASE_URL to a Postgres connection string.\n',
  );
}
