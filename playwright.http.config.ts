import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from '@playwright/test';

/** Reads T2F_WEB_PORT from server/.env.local (same line format as server/test/integration/global-setup.ts). */
function webPort(): string | undefined {
  const file = path.join(process.cwd(), 'server', '.env.local');
  if (!fs.existsSync(file)) return undefined;
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
    if (m && m[1] === 'T2F_WEB_PORT') return m[2];
  }
  return undefined;
}

const port = webPort();
const baseURL = process.env.T2F_E2E_BASE ?? (port ? `http://127.0.0.1:${port}` : undefined);

// No webServer: the integration build and the server are started by `pnpm build:int`, `pnpm serve:int`, `pnpm stack`.
// The build is mixed (catalog over http, the other domains on sim, time machine as in the test build), so every domain e2e
// runs here unchanged. Smoke for the catalog switch (SPEC-04 W53 step 5): `tests/e2e/us2-country.spec.ts`.
export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: /.*\.prod\.spec\.ts/,
  workers: 2,
  fullyParallel: true,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', baseURL },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } } },
    { name: 'desktop', use: { viewport: { width: 1520, height: 900 } } },
  ],
});
