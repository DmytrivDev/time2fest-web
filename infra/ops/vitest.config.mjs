import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.mjs'],
    exclude: ['test/node/**'],
    testTimeout: 30_000,
  },
});
