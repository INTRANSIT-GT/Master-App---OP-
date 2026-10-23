import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    env: { DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgres://omnia:omnia_dev@localhost:5432/omnia_test', NODE_ENV: 'test', JWT_SECRET: 'test-secret' },
    fileParallelism: false, testTimeout: 30000, hookTimeout: 60000,
  },
});
