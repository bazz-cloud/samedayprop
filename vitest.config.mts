import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    globalSetup: ['./tests/setup-db.ts'],
    // Integration tests share one database, so they run in a single process.
    // Financial invariants must be deterministic: no retries masking flakiness.
    fileParallelism: false,
    retry: 0,
    sequence: { shuffle: false },
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
