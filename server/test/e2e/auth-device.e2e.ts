/**
 * SPEC-10 W31 — device and sessions end to end against the served worktree server (`node scripts/stack.mjs serve`,
 * test class, doors on, mail to Mailpit). Playwright `request` contexts keep the cookies.
 * - AC-2: sign in as A → sign out → sign in as B on the same device: both session rows carry the same device id
 *   (read straight from the database) and `t2f_device` never changes.
 * - AC-25: a revoked session cookie on a new sign-in (revoked by a sign-out from another context holding the same
 *   cookie): the new session cookie survives and `get-session` has the user.
 * Codes come from Mailpit through the test door `POST /api/_test/auth/last-code`.
 * Env: T2F_E2E_SERVER (default http://127.0.0.1:4200), T2F_E2E_ORIGIN (an allowed origin, default the slot web
 * port), T2F_E2E_DATABASE_URI (the served server's database). Skips without the database URI.
 */
import { randomBytes } from 'node:crypto';
import { expect, request, test, type APIRequestContext } from '@playwright/test';
import pg from 'pg';

const server = process.env.T2F_E2E_SERVER ?? 'http://127.0.0.1:4200';
const origin = process.env.T2F_E2E_ORIGIN ?? 'http://127.0.0.1:4201';
const databaseUri = process.env.T2F_E2E_DATABASE_URI ?? '';
const SESSION = '__Secure-t2f.session_token';
const COLD_MS = 120_000;
const tag = randomBytes(4).toString('hex');
const email = (who: string) => `t2f-e2e-${who}-${tag}@t2f.test`;

test.skip(databaseUri === '', 'set T2F_E2E_DATABASE_URI (the served server database)');
// The first request of a cold dev server compiles the routes.
test.describe.configure({ timeout: 3 * COLD_MS });

let pool: pg.Pool;

test.beforeAll(() => {
  pool = new pg.Pool({ connectionString: databaseUri, max: 2 });
});

test.afterAll(async () => {
  await pool?.query(`DELETE FROM users WHERE email LIKE $1`, [`%-${tag}@t2f.test`]);
  await pool?.end();
});

const post = (ctx: APIRequestContext, path: string, data: unknown) =>
  ctx.post(`${server}${path}`, { data, headers: { origin }, timeout: COLD_MS });

async function cookie(ctx: APIRequestContext, name: string): Promise<string | undefined> {
  return (await ctx.storageState()).cookies.find((c) => c.name === name)?.value;
}

async function signIn(ctx: APIRequestContext, to: string): Promise<void> {
  const sent = await post(ctx, '/api/auth/email-otp/send-verification-otp', { email: to, intent: 'signin' });
  expect(sent.status(), await sent.text()).toBe(200);
  let code: string | undefined;
  for (let i = 0; i < 50 && code === undefined; i += 1) {
    const res = await post(ctx, '/api/_test/auth/last-code', { to });
    if (res.status() === 200) code = ((await res.json()) as { value: { code: string } }).value.code;
    else await new Promise((r) => setTimeout(r, 200));
  }
  expect(code).toMatch(/^\d{6}$/);
  const verified = await post(ctx, '/api/auth/sign-in/email-otp', { email: to, otp: code });
  expect(verified.status(), await verified.text()).toBe(200);
}

async function sessionUser(ctx: APIRequestContext): Promise<{ id: string; email: string } | null> {
  const res = await ctx.get(`${server}/api/auth/get-session`, { timeout: COLD_MS });
  expect(res.status()).toBe(200);
  return ((await res.json()) as { value: { user: { id: string; email: string } | null } }).value.user;
}

const sessionDevices = async (userId: string): Promise<(string | null)[]> =>
  ((await pool.query(`SELECT device_id FROM user_sessions WHERE user_id = $1`, [userId])).rows as { device_id: string | null }[]).map((r) => r.device_id);

test('AC-2: in as A → out → in as B on one device: same device id in both sessions, t2f_device unchanged', async () => {
  const ctx = await request.newContext();
  try {
    expect((await ctx.get(`${server}/api/auth/get-session`, { timeout: COLD_MS })).status()).toBe(200);
    const device = await cookie(ctx, 't2f_device');
    expect(device, 'the request context keeps the Secure device cookie').toMatch(/^[A-Za-z0-9_-]{22}$/);

    await signIn(ctx, email('a'));
    const a = await sessionUser(ctx);
    expect(a?.email).toBe(email('a'));
    expect(await sessionDevices(a!.id)).toEqual([device]);
    expect((await post(ctx, '/api/auth/sign-out', {})).status()).toBe(200);
    expect(await sessionUser(ctx)).toBeNull();
    expect(await sessionDevices(a!.id)).toEqual([]);

    await signIn(ctx, email('b'));
    const b = await sessionUser(ctx);
    expect(b?.email).toBe(email('b'));
    expect(b?.id).not.toBe(a?.id);
    expect(await sessionDevices(b!.id)).toEqual([device]);
    expect(await cookie(ctx, 't2f_device')).toBe(device);
  } finally {
    await ctx.dispose();
  }
});

test('AC-25: a revoked session cookie on a new sign-in → the new session cookie survives', async () => {
  const ctx = await request.newContext();
  try {
    await signIn(ctx, email('e'));
    const dead = await cookie(ctx, SESSION);
    expect(dead).toBeTruthy();
    // Another context with the same cookie signs out: the cookie in `ctx` is now revoked.
    const other = await request.newContext({ storageState: await ctx.storageState() });
    expect((await post(other, '/api/auth/sign-out', {})).status()).toBe(200);
    await other.dispose();

    await signIn(ctx, email('e2'));
    const fresh = await cookie(ctx, SESSION);
    expect(fresh).toBeTruthy();
    expect(fresh).not.toBe(dead);
    expect((await sessionUser(ctx))?.email).toBe(email('e2'));
  } finally {
    await ctx.dispose();
  }
});
