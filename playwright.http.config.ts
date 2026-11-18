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
// The build is mixed (catalog over http, the other domains on sim, time machine = a view of the SERVER test clock, SPEC-07),
// so every domain e2e runs here unchanged. Smoke for the catalog switch (SPEC-04 W53 step 5): `tests/e2e/us2-country.spec.ts`.
//
// NFR-4: the time machine now moves ONE shared server clock, so every spec that uses it runs serially in `server-clock`
// and nowhere else. Two invocations (the serial one first):
//   npx playwright test -c playwright.http.config.ts --project=server-clock --workers=1
//   npx playwright test -c playwright.http.config.ts --project=phone --project=desktop --workers=2
// `server-clock` needs T2F_E2E_SERVER=http://127.0.0.1:<server port> (test doors answer on loopback only).
// `edge-offline` is a separate project against a production-mode edge: see tests/e2e/edge-offline/server-stopped.spec.ts.
//
// Matching is by path under tests/e2e (testMatch/testIgnore), never by a worktree-path grep: a worktree named
// `spec-07-clock-server` would otherwise match every file.
const E2E = '.tests.e2e.'; // `.` = either path separator, no backslashes to escape
const CLOCK_SPECS = ['global-states', 'us1-air', 'us16-notifications', 'us17-pass', 'us3-room', 'us7-tv', 'us8-time-machine', 'us9-auth'];
const clockSpecs = new RegExp(`${E2E}(server-clock.[^.]*[.]spec[.]ts|(${CLOCK_SPECS.join('|')})[.]spec[.]ts)$`);
const edgeOffline = new RegExp(`${E2E}edge-offline.[^.]*[.]spec[.]ts$`);

export default defineConfig({
  testDir: './tests/e2e',
  testIgnore: /.*\.prod\.spec\.ts/,
  workers: 2,
  fullyParallel: true,
  reporter: [['list']],
  use: { trace: 'retain-on-failure', baseURL },
  projects: [
    { name: 'phone', use: { viewport: { width: 390, height: 844 } }, testIgnore: [/.*\.prod\.spec\.ts/, clockSpecs, edgeOffline] },
    { name: 'desktop', use: { viewport: { width: 1520, height: 900 } }, testIgnore: [/.*\.prod\.spec\.ts/, clockSpecs, edgeOffline] },
    {
      name: 'server-clock',
      use: { viewport: { width: 1520, height: 900 } },
      testMatch: clockSpecs,
      testIgnore: /.*\.prod\.spec\.ts/,
      fullyParallel: false,
    },
    {
      name: 'edge-offline',
      use: { viewport: { width: 1520, height: 900 }, baseURL: process.env.T2F_EDGE_BASE },
      testMatch: edgeOffline,
      fullyParallel: false,
    },
  ],
});
