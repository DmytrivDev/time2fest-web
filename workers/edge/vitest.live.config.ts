import { defineConfig } from 'vitest/config';

// Live suite against the real edge (SPEC-05 W26). Skipped entirely unless T2F_LIVE_SITE is set.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['live/**/*.live.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 60_000,
    maxWorkers: 1,
    passWithNoTests: true,
  },
});
