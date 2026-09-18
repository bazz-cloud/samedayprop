/**
 * Integration test database.
 *
 * Each run gets its own SQLite file, created from the current schema, so tests
 * never touch the development database and never depend on leftover state.
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let directory: string | null = null;

export function setup(): void {
  directory = mkdtempSync(join(tmpdir(), 'sdp-test-'));
  const url = `file:${join(directory, 'test.db')}`;
  process.env.DATABASE_URL = url;
  process.env.APP_MODE = 'DEMO';

  execFileSync('npx', ['prisma', 'db', 'push', '--skip-generate', '--accept-data-loss'], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

export function teardown(): void {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
