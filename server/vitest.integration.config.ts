import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/support/env.ts'],
    restoreMocks: true,
    clearMocks: true,
    env: {
      RUN_TESTCONTAINERS: '1',
    },
    include: ['tests/integration/**/*.spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 90_000,
    hookTimeout: 120_000,
  },
});
