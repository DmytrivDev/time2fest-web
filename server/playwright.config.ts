import { defineConfig } from '@playwright/test';

/**
 * e2e against servers the orchestrator starts (SPEC-02 W29); no webServer here.
 * T2F_E2E_BASE is the base URL of the site under test; the specs read their own extra variables.
 */
export default defineConfig({
  testDir: 'test/e2e',
  testMatch: /.*\.e2e\.ts/,
  workers: 2,
  reporter: [['list']],
  use: { baseURL: process.env.T2F_E2E_BASE },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
});
