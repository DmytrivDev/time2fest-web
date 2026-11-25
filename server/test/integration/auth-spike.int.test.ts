/**
 * SPEC-10 W5 — SPIKE on Better Auth 1.7.28 (kept as a library-behaviour regression test: an upgrade that changes any
 * of these behaviours turns this file red). A minimal Better Auth instance in its own Postgres schema `auth_spike`
 * of the worktree test DB (dropped in `afterAll`); fake Google = compose `oidc` (mock-oauth2-server 7.0.2).
 *
 * Outcome table (observed on 1.7.28, 2026-11-25 → branch taken by later phases):
 * | S1 | `databaseHooks.session.delete.after` fires once per session on `/sign-out` (1), `auth.api.revokeSessions` (2 of 2)
 * |    | and `internalAdapter.deleteUser` (1) → W29/W40: publish `signed-out` from the hook; no extra explicit publish. |
 * | S2 | anonymous → `/sign-in/social` google → mock (email_verified true) → `/callback/google`: 302 to callbackURL,
 * |    | `onLinkAccount` once, guest row deleted, new user `emailVerified=true`. email_verified false: new email → user with
 * |    | `emailVerified=false`; email of an existing account → 302 `errorCallbackURL?error=account_not_linked`, no rows,
 * |    | no cookie → W33: no `mapProfileToUser` needed; map `account_not_linked` to `error=failed` (AC-21). Not blocked. |
 * | S3 | #11533 reproduced: a revoked session cookie on `/sign-in/email-otp` → the last `set-cookie` is a delete
 * |    | (`Max-Age=0`). Dropping the cookie from the request when `getSession` is null → new cookie survives → W15 does it. |
 * | S4 | `x-t2f-ip: fp:<hex>` is not a valid IP → ignored (test/dev fall back to 127.0.0.1; production → shared bucket).
 * |    | fd00::/8 IPv6 is accepted but masked to /64 by default → W15: `fd00::/8` + 120 bits of sha256 AND
 * |    | `advanced.ipAddress.ipv6Subnet: 128`. |
 * | S5 | mock-oauth2-server 7.0.2 login form: POST authorize URL with `username` and `claims` (JSON with `sub`, `email`,
 * |    | `email_verified`, `name`) → id_token carries them; account row `{providerId:'google', accountId:sub}` → W4, W26. |
 * | S6 | `sign-in/email-otp` JSON = `{token, user}`; `get-session` `session.token` present → W15 strips both (AC-14). |
 * | S7 | `verification` row identifier `sign-in-otp-<email>` (email in clear), value `<sha256 b64url>:<wrong tries>`;
 * |    | tries 1–5 wrong → 400 INVALID_OTP (count 1..5), the 6th → 403 TOO_MANY_ATTEMPTS and the row is gone →
 * |    | W24: attemptsLeft = 5 − count read from the row; on the 5th wrong (count reaches 5) answer `too-many-attempts`
 * |    | ourselves (AC-12) — Better Auth alone says so only on the 6th try. |
 * | S8 | `auth.api.signInAnonymous({ headers, returnHeaders: true })` → `headers.get('set-cookie')` has the session cookie,
 * |    | usable as-is; anonymous → `/sign-in/email-otp` fires `onLinkAccount` once and deletes the guest → W28 as planned. |
 */
import { appendFileSync } from 'node:fs';
import pg from 'pg';
import { betterAuth } from 'better-auth';
import { getMigrations } from 'better-auth/db/migration';
import { anonymous, emailOTP, genericOAuth } from 'better-auth/plugins';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CookieJar, FAKE_OIDC_DISCOVERY, fakeGoogleLogin } from '../support/fakeOidc';

const BASE = 'http://127.0.0.1:4200';
const SCHEMA = 'auth_spike';
const SECRET = 'spike-secret-not-real-0123456789abcdef0123456789'; // check-secrets: allow test fake
const COOKIE = 'better-auth.session_token';
const RUN = Math.random().toString(36).slice(2, 8);
const email = (name: string) => `${name}+spike-${RUN}@example.test`;
/** Observations go to a file when T2F_SPIKE_LOG is set (vitest hides console output of passing tests). */
const note = (tag: string, data: unknown) => {
  const file = process.env.T2F_SPIKE_LOG;
  if (file) appendFileSync(file, `${tag} ${JSON.stringify(data)}
`);
};

const otps = new Map<string, string>();
const sessionDeletes: string[] = [];
const sessionCreates: { userId: string; ipAddress?: string | null }[] = [];
const links: { anonymousUserId: string; newUserId: string }[] = [];

let pool: pg.Pool;

function makeOptions(ipv6Subnet?: number) {
  return {
    baseURL: BASE,
    basePath: '/api/auth',
    secret: SECRET,
    database: pool,
    trustedOrigins: [BASE],
    telemetry: { enabled: false },
    session: { cookieCache: { enabled: false } },
    account: { accountLinking: { enabled: true, trustedProviders: [] as string[], allowDifferentEmails: false } },
    advanced: { ipAddress: { ipAddressHeaders: ['x-t2f-ip'], ...(ipv6Subnet === undefined ? {} : { ipv6Subnet }) } },
    databaseHooks: {
      session: {
        create: {
          after: async (s: { userId: string; ipAddress?: string | null }) => {
            sessionCreates.push({ userId: s.userId, ipAddress: s.ipAddress });
          },
        },
        delete: {
          after: async (s: { id: string }) => {
            sessionDeletes.push(s.id);
          },
        },
      },
    },
    plugins: [
      anonymous({
        onLinkAccount: async ({ anonymousUser, newUser }) => {
          links.push({ anonymousUserId: anonymousUser.user.id, newUserId: newUser.user.id });
        },
      }),
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: 'hashed',
        disableSignUp: false,
        sendVerificationOTP: async ({ email: to, otp }) => {
          otps.set(to, otp);
        },
      }),
      genericOAuth({
        config: [
          {
            providerId: 'google',
            discoveryUrl: FAKE_OIDC_DISCOVERY,
            clientId: 'spike-client',
            clientSecret: 'spike-client-secret-not-real', // check-secrets: allow test fake
            scopes: ['openid', 'email', 'profile'],
            pkce: true,
          },
        ],
      }),
    ],
  };
}

function makeAuth(ipv6Subnet?: number) {
  return betterAuth(makeOptions(ipv6Subnet));
}
type Auth = ReturnType<typeof makeAuth>;
let auth: Auth;

const call = (path: string, init: { method?: string; body?: unknown; jar?: CookieJar; headers?: Record<string, string> } = {}) =>
  auth.handler(
    new Request(BASE + '/api/auth' + path, {
      method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
      headers: {
        origin: BASE,
        ...(init.body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(init.jar?.headers() ?? {}),
        ...(init.headers ?? {}),
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    }),
  );

async function signInCode(jar: CookieJar, to: string): Promise<Response> {
  const sent = await call('/email-otp/send-verification-otp', { body: { email: to, type: 'sign-in' }, jar });
  expect(sent.status).toBe(200);
  const otp = otps.get(to);
  expect(otp).toMatch(/^\d{6}$/);
  const res = await call('/sign-in/email-otp', { body: { email: to, otp }, jar });
  jar.store(res);
  return res;
}

async function signInAnon(jar: CookieJar, headers: Record<string, string> = {}): Promise<string> {
  const res = await call('/sign-in/anonymous', { method: 'POST', body: {}, jar, headers });
  expect(res.status).toBe(200);
  jar.store(res);
  const body = (await res.json()) as { user: { id: string } };
  return body.user.id;
}

async function userRow(id: string) {
  const r = await pool.query('SELECT * FROM "user" WHERE id = $1', [id]);
  return r.rows[0] as Record<string, unknown> | undefined;
}

/** Runs the Google flow from a jar; returns the final redirect of our callback and the callback response. */
async function googleFlow(jar: CookieJar, user: { sub: string; email: string; emailVerified: boolean; name?: string }) {
  const start = await call('/sign-in/social', { body: { provider: 'google', callbackURL: '/done', errorCallbackURL: '/err' }, jar });
  jar.store(start);
  const { url } = (await start.json()) as { url: string };
  const location = await fakeGoogleLogin(url, user);
  const cb = new URL(location);
  const res = await auth.handler(new Request(cb.toString(), { headers: { ...jar.headers() } }));
  jar.store(res);
  return { res, location: res.headers.get('location') ?? '', redirectUri: `${cb.origin}${cb.pathname}` };
}

beforeAll(async () => {
  const uri = process.env.DATABASE_URI;
  if (!uri) throw new Error('DATABASE_URI is not set (global setup)');
  const admin = new pg.Client({ connectionString: uri });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.end();
  pool = new pg.Pool({ connectionString: uri, options: `-c search_path=${SCHEMA}`, max: 4 });
  const { runMigrations } = await getMigrations(makeOptions());
  await runMigrations();
  auth = makeAuth();
});

afterAll(async () => {
  await pool?.end();
  const admin = new pg.Client({ connectionString: process.env.DATABASE_URI });
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(() => {
  sessionDeletes.length = 0;
  sessionCreates.length = 0;
  links.length = 0;
});

describe('Better Auth 1.7.28 spike', () => {
  it('S1 — session.delete.after on sign-out, revokeSessions, deleteUser', async () => {
    const a = new CookieJar();
    await signInCode(a, email('s1a'));
    const out = await call('/sign-out', { method: 'POST', body: {}, jar: a });
    expect(out.status).toBe(200);
    const afterSignOut = sessionDeletes.length;

    const b = new CookieJar();
    await signInCode(b, email('s1b'));
    const b2 = new CookieJar();
    await signInCode(b2, email('s1b'));
    sessionDeletes.length = 0;
    await auth.api.revokeSessions({ headers: new Headers(b.headers()) });
    const afterRevoke = sessionDeletes.length;

    const c = new CookieJar();
    await signInCode(c, email('s1c'));
    const session = await auth.api.getSession({ headers: new Headers(c.headers()) });
    sessionDeletes.length = 0;
    const ctx = await auth.$context;
    await ctx.internalAdapter.deleteUser(session!.user.id);
    const afterDeleteUser = sessionDeletes.length;

    note('[S1]', { afterSignOut, afterRevoke, afterDeleteUser });
    expect({ afterSignOut, afterRevoke, afterDeleteUser }).toEqual({ afterSignOut: 1, afterRevoke: 2, afterDeleteUser: 1 });
  });

  it('S2 — anonymous → Google (email_verified true) links and deletes the guest; false: stored flag and implicit linking', async () => {
    const jar = new CookieJar();
    const anonId = await signInAnon(jar);
    const g = await googleFlow(jar, { sub: `g-${RUN}-1`, email: email('s2'), emailVerified: true, name: 'Spike One' });
    note('[S2] verified', { status: g.res.status, location: g.location, redirectUri: g.redirectUri });
    expect(g.res.status).toBe(302);
    expect(g.location).toBe('/done');
    expect(g.redirectUri).toBe(`${BASE}/api/auth/callback/google`);
    expect(links).toHaveLength(1);
    expect(links[0]?.anonymousUserId).toBe(anonId);
    expect(await userRow(anonId)).toBeUndefined();
    const newUser = await userRow(links[0]!.newUserId);
    expect(newUser?.emailVerified).toBe(true);
    expect(newUser?.isAnonymous).toBe(false);

    // email_verified false, new email → user created with emailVerified false (no mapProfileToUser needed)
    const j2 = new CookieJar();
    const g2 = await googleFlow(j2, { sub: `g-${RUN}-2`, email: email('s2u'), emailVerified: false });
    const s2 = await auth.api.getSession({ headers: new Headers(j2.headers()) });
    const u2 = s2 ? await userRow(s2.user.id) : undefined;
    note('[S2] unverified new', { status: g2.res.status, location: g2.location, emailVerified: u2?.emailVerified });
    expect(g2.location).toBe('/done');
    expect(u2?.emailVerified).toBe(false);

    // email_verified false, email of an existing (code) account → NO implicit link, no rows, error redirect
    const owner = new CookieJar();
    await signInCode(owner, email('s2x'));
    const ownerSession = await auth.api.getSession({ headers: new Headers(owner.headers()) });
    const j3 = new CookieJar();
    const g3 = await googleFlow(j3, { sub: `g-${RUN}-3`, email: email('s2x'), emailVerified: false });
    const acc = await pool.query('SELECT "providerId" FROM account WHERE "userId" = $1', [ownerSession!.user.id]);
    const users = await pool.query('SELECT count(*)::int AS n FROM "user" WHERE email = $1', [email('s2x')]);
    note('[S2] unverified existing', { status: g3.res.status, location: g3.location, accounts: acc.rows, users: users.rows[0] });
    expect(g3.res.status).toBe(302);
    expect(g3.location).toBe('/err?error=account_not_linked');
    expect(acc.rows.map((r: { providerId: string }) => r.providerId)).not.toContain('google');
    expect(users.rows[0]).toEqual({ n: 1 });
    expect(j3.get(COOKIE)).toBeUndefined();
  });

  it('S3 — dead session cookie on sign-in (#11533) is deleted; the workaround keeps the new one', async () => {
    const to = email('s3');
    const jar = new CookieJar();
    await signInCode(jar, to);
    const dead = jar.get(COOKIE)!;
    const ctx = await auth.$context;
    const s = await auth.api.getSession({ headers: new Headers(jar.headers()) });
    await ctx.internalAdapter.deleteUserSessions(s!.user.id);

    const again = await signInCode(jar.set(COOKIE, dead), to);
    expect(again.status).toBe(200);
    const lines = again.headers.getSetCookie().filter((l) => l.startsWith(COOKIE + '='));
    note('[S3] without workaround', lines.map((l) => /max-age=-?\d+/i.exec(l)?.[0]));
    expect(lines.at(-1)).toMatch(/Max-Age=0/i);
    expect(jar.get(COOKIE)).toBeUndefined();

    // workaround: drop the session cookie from the request when getSession returns null
    const j2 = new CookieJar().set(COOKIE, dead);
    const live = await auth.api.getSession({ headers: new Headers(j2.headers()) });
    expect(live).toBeNull();
    j2.delete(COOKIE);
    const fixed = await signInCode(j2, to);
    const lines2 = fixed.headers.getSetCookie().filter((l) => l.startsWith(COOKIE + '='));
    note('[S3] with workaround', lines2.map((l) => /max-age=-?\d+/i.exec(l)?.[0]));
    expect(lines2.at(-1)).not.toMatch(/Max-Age=0/i);
    expect(await auth.api.getSession({ headers: new Headers(j2.headers()) })).not.toBeNull();
  });

  it('S4 — x-t2f-ip: `fp:<hex>` is not an IP; fd00::/8 works only with ipv6Subnet 128', async () => {
    const V6 = 'fd12:3456:789a:bcde:f012:3456:789a:bcde';
    await signInAnon(new CookieJar(), { 'x-t2f-ip': 'fp:0123abcd' });
    const ipFp = sessionCreates.at(-1)?.ipAddress;
    await signInAnon(new CookieJar(), { 'x-t2f-ip': V6 });
    const ipV6Default = sessionCreates.at(-1)?.ipAddress;
    const saved = auth;
    auth = makeAuth(128);
    try {
      await signInAnon(new CookieJar(), { 'x-t2f-ip': V6 });
    } finally {
      auth = saved;
    }
    const ipV6Full = sessionCreates.at(-1)?.ipAddress;
    note('[S4]', { ipFp, ipV6Default, ipV6Full });
    // Not a valid IP → ignored; test/dev fall back to 127.0.0.1 (production: null → one shared bucket).
    expect(ipFp).toBe('127.0.0.1');
    expect(ipV6Default).toBe('fd12:3456:789a:bcde:0000:0000:0000:0000');
    expect(ipV6Full).toBe(V6);
  });

  it('S5 — mock login form: `username` + `claims` JSON give sub, email, email_verified, name', async () => {
    const sub = `g-${RUN}-5`;
    const jar = new CookieJar();
    const g = await googleFlow(jar, { sub, email: email('s5'), emailVerified: true, name: 'Spike Five' });
    expect(g.location).toBe('/done');
    const s = await auth.api.getSession({ headers: new Headers(jar.headers()) });
    const u = await userRow(s!.user.id);
    const acc = await pool.query('SELECT "providerId", "accountId" FROM account WHERE "userId" = $1', [s!.user.id]);
    note('[S5]', { name: u?.name, emailVerified: u?.emailVerified, accounts: acc.rows.length });
    expect({ email: u?.email, name: u?.name, emailVerified: u?.emailVerified }).toEqual({ email: email('s5'), name: 'Spike Five', emailVerified: true });
    expect(acc.rows).toEqual([{ providerId: 'google', accountId: sub }]);
  });

  it('S6 — sign-in/email-otp and get-session JSON carry the session token (#12947)', async () => {
    const jar = new CookieJar();
    const res = await signInCode(jar, email('s6'));
    const signInBody = (await res.json()) as Record<string, unknown>;
    const gs = await call('/get-session', { jar });
    const gsBody = (await gs.json()) as { session?: Record<string, unknown> };
    note('[S6]', { signInKeys: Object.keys(signInBody), sessionKeys: Object.keys(gsBody.session ?? {}) });
    expect(signInBody).toHaveProperty('token');
    expect(gsBody.session).toHaveProperty('token');
  });

  it('S7 — wrong-code attempts live in verification.value `<hash>:<n>`; the try after 5 wrong is TOO_MANY_ATTEMPTS', async () => {
    const to = email('s7');
    await call('/email-otp/send-verification-otp', { body: { email: to, type: 'sign-in' } });
    const good = otps.get(to)!;
    const bad = good === '000000' ? '111111' : '000000';
    const codes: string[] = [];
    const counts: (string | null)[] = [];
    for (let i = 0; i < 6; i++) {
      const r = await call('/sign-in/email-otp', { body: { email: to, otp: bad } });
      codes.push(`${r.status}:${((await r.json()) as { code?: string }).code}`);
      const v = await pool.query('SELECT value FROM verification WHERE identifier = $1', [`sign-in-otp-${to}`]);
      const value = (v.rows[0] as { value?: string } | undefined)?.value;
      if (value) expect(value.startsWith(good)).toBe(false);
      counts.push(value ? value.slice(value.lastIndexOf(':') + 1) : null);
    }
    note('[S7]', { codes, counts });
    expect(codes).toEqual([...Array<string>(5).fill('400:INVALID_OTP'), '403:TOO_MANY_ATTEMPTS']);
    expect(counts).toEqual(['1', '2', '3', '4', '5', null]);
  });

  it('S8 — server-side signInAnonymous with returnHeaders gives a session cookie; anonymous → email-otp fires onLinkAccount', async () => {
    const r = await auth.api.signInAnonymous({ headers: new Headers({ origin: BASE }), returnHeaders: true });
    expect(r.headers.get('set-cookie') ?? '').toContain(COOKIE + '=');
    const jar = new CookieJar().store(r.headers);
    const s = await auth.api.getSession({ headers: new Headers(jar.headers()) });
    expect((s?.user as { isAnonymous?: boolean } | undefined)?.isAnonymous).toBe(true);
    await signInCode(jar, email('s8'));
    note('[S8]', { links: links.length });
    expect(links).toHaveLength(1);
    expect(links[0]?.anonymousUserId).toBe(s!.user.id);
    expect(await userRow(s!.user.id)).toBeUndefined();
  });
});
