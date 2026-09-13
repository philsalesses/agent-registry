import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    env: {
      ANS_DISABLE_JOBS: '1',
      ANS_QUIET: '1',
    },
    // The integration test shares one Postgres database with its API server
    fileParallelism: false,
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
