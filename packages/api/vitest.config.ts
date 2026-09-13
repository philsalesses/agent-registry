import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    setupFiles: ['dotenv/config'],
    env: {
      ANS_DISABLE_JOBS: '1',
      ANS_QUIET: '1',
    },
    // Tests share one Postgres database; run files sequentially so ledger
    // chain and rate-limit assertions do not interleave.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
