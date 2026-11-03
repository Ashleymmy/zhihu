import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/support/env.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    restoreMocks: true,
    clearMocks: true,
    // The Windows runner can spin after a parallel run has completed. Keep
    // files sequential there; concurrency exercised inside each test remains.
    fileParallelism: process.platform !== 'win32',
    testTimeout: 15_000,
  },
});
