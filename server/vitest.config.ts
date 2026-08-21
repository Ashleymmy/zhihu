import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    setupFiles: ['./tests/support/env.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    restoreMocks: true,
    clearMocks: true,
    testTimeout: 15_000,
  },
});
