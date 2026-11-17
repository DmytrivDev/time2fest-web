import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', include: ['test/**/*.test.ts'] },
  resolve: {
    alias: { '@time2fest/rules/time': fileURLToPath(new URL('./src/time/index.ts', import.meta.url)) },
  },
});
