import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['tests/attribution/**/*.spec.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    testTimeout: 30000,
    hookTimeout: 90000,
    env: {
      NODE_ENV: 'test',
      OPC_MODULES: '',
      QUEUE_DRIVER: 'memory',
      JWT_SECRET: 'attribution_test_secret_at_least_32_characters',
      LOG_LEVEL: 'silent',
    },
  },
});
