import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { alias: { '@payload-config': fileURLToPath(new URL('./src/payload.config.ts', import.meta.url)) } },
  test: {
    environment: 'node',
    include: process.env.T2F_EXCLUSIVE ? ['test/exclusive/**/*.test.ts'] : ['test/integration/**/*.int.test.ts'],
    fileParallelism: false,
    maxWorkers: 1,
    globalSetup: './test/integration/global-setup.ts',
    testTimeout: 30000,
    // The reset reseeds the whole catalog and the first request builds Payload: 10 s is no margin on a loaded machine.
    hookTimeout: 60000,
  },
});
