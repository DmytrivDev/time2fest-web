/**
 * SPEC-10 W35 — Google sign-in in a real browser against the served worktree server (`node scripts/stack.mjs serve`,
 * test class, Google = the fake OIDC `oidc` compose service on 127.0.0.1:8091; never accounts.google.com).
 * - AC-17: return path `/countries/ua?x=1#a` → the browser ends on `/countries/ua?x=1&signin=google&new=1#a` of our
 *   server (the page itself may be a 404 there — only the URL is asserted).
 * - AC-18: `https://evil.example/`, `//evil.example`, `/%2F%2Fevil` → `/` of our server.
 * - AC-19: cancel at Google (`access_denied`) → `?error=cancelled` on the return path.
 * The sign-in request goes through the page's own request context (same cookie jar as the browser), the login form
 * of the fake is filled like a person would; the URL asserted is the first landing on our site (see `landing`). Env: T2F_E2E_SERVER (default http://127.0.0.1:4200), T2F_E2E_ORIGIN (an
 * allowed origin, default the slot web port), T2F_E2E_DATABASE_URI (optional: removes the made-up users afterwards).
 */
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';

const server = process.env.T2F_E2E_SERVER ?? 'http://127.0.0.1:4200';
const origin = process.env.T2F_E2E_ORIGIN ?? 'http://127.0.0.1:4201';
const databaseUri = process.env.T2F_E2E_DATABASE_URI ?? '';
const ISSUER = 'http://127.0.0.1:8091/google';
const COLD_MS = 120_000;
const tag = randomBytes(4).toString('hex');
const email = (who: string) => `t2f-e2e-g${who}-${tag}@t2f.test`;

// The first request of a cold dev server compiles the routes.
test.describe.configure({ timeout: 3 * COLD_MS });

// A visitor arrives from the site, so the browser already knows this origin's client hints (Payload's `Accept-CH`).
// Without that, the server's own dev 404 page on the return path answers with `Critical-CH` and Chromium restarts the
// whole navigation from the (already spent) callback URL — an artefact of the return page living on the API server.
test.beforeEach(async ({ page }) => {
  await page.goto(`${server}/api/time`, { timeout: COLD_MS });
});

/** The first page of our site the browser lands on after the callback (the return page itself is not under test). */
async function landing(page: Page, act: () => Promise<unknown>): Promise<string> {
  const own = new URL(server).origin;
  await Promise.all([
    page.waitForURL((u) => u.origin === own && !u.pathname.startsWith('/api/'), { timeout: COLD_MS, waitUntil: 'commit' }),
    act(),
  ]);
  return page.url();
}

test.afterAll(async () => {
  if (databaseUri === '') return;
  const pool = new pg.Pool({ connectionString: databaseUri, max: 1 });
  await pool.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${tag}@t2f.test`]);
  await pool.end();
});

/** `POST /api/auth/sign-in/social` from the page's context; answers the Google authorize URL. */
async function start(page: Page, returnPath: string): Promise<string> {
  const res = await page.request.post(`${server}/api/auth/sign-in/social`, { data: { returnPath }, headers: { origin }, timeout: COLD_MS });
  expect(res.status(), await res.text()).toBe(200);
  const { value } = (await res.json()) as { value: { kind: string; url: string } };
  expect(value.kind).toBe('redirect');
  expect(value.url.startsWith(`${ISSUER}/`)).toBe(true);
  return value.url;
}

/** Signs in at the fake Google as a new verified user; answers the URL the browser ends on. */
async function signInWithGoogle(page: Page, returnPath: string, who: string): Promise<string> {
  await page.goto(await start(page, returnPath));
  const sub = `g-e2e-${who}-${tag}`;
  await page.fill('input[name="username"]', sub);
  await page.fill('textarea[name="claims"]', JSON.stringify({ sub, email: email(who), email_verified: true, name: 'E2E' }));
  return landing(page, () => page.click('input[type="submit"]'));
}

test('AC-17: a new account comes back to the return path with signin=google&new=1, hash kept', async ({ page }) => {
  const url = await signInWithGoogle(page, '/countries/ua?x=1#a', 'new');
  expect(url).toBe(`${server}/countries/ua?x=1&signin=google&new=1#a`);
});

for (const [i, unsafe] of ['https://evil.example/', '//evil.example', '/%2F%2Fevil'].entries()) {
  test(`AC-18: unsafe return path ${unsafe} → /`, async ({ page }) => {
    const url = await signInWithGoogle(page, unsafe, `evil${i}`);
    expect(url).toBe(`${server}/?signin=google&new=1`);
  });
}

test('AC-19: cancel at Google → error=cancelled on the return path', async ({ page }) => {
  const authorize = new URL(await start(page, '/countries/ua?x=1#a'));
  const state = authorize.searchParams.get('state') ?? '';
  expect(state).not.toBe('');
  // What Google does when the person presses «cancel»: back to our callback with access_denied.
  const cancel = new URL('/api/auth/callback/google', server);
  cancel.searchParams.set('error', 'access_denied');
  cancel.searchParams.set('state', state);
  const url = await landing(page, () => page.goto(cancel.toString(), { timeout: COLD_MS, waitUntil: 'commit' }));
  expect(url).toBe(`${server}/countries/ua?x=1&error=cancelled#a`);
});
