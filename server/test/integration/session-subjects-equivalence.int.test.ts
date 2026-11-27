/**
 * SPEC-14 W5 (review) — the fast subject read (`adapters/sessionSubjects.ts`) against Better Auth's own
 * `auth.api.getSession` on this slot's Postgres: for every cookie of the matrix the fast path either answers exactly
 * the subject Better Auth answers, or defers to it (`undefined`); it never answers where Better Auth says "no session".
 * The guest cookie is issued by Better Auth itself (pins the cookie format); the account sessions are rows signed with
 * the instance secret, so Better Auth's own signature check is the oracle for the format the fast path assumes.
 * Also pins the better-auth / better-call versions the fast path was verified against.
 */
import { createHmac, randomBytes, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { fastSubjectOf, sessionSubjectOf, SIGNED_COOKIE_MAX, startGuestSession } from '../../src/adapters/sessionSubjects';
import { createAuthWiring, AUTH_IP_HEADER, type AuthWiring } from '../../src/auth/instance';
import { ipHeaderValue } from '../../src/auth/request';
import { sessionCookieName } from '../../src/auth/response';
import { DEVICE_COOKIE } from '../../src/platform/device';
import type { RealtimeSubject } from '../../src/realtime/ports';
import { ownRedis, testDeps } from './helpers';

const RUN = randomUUID().slice(0, 8);
const redis = ownRedis();
let pool: pg.Pool;
let wiring: AuthWiring;
let secret: string;
let cookieName: string;
const users: string[] = [];

const sign = (token: string) => encodeURIComponent(`${token}.${createHmac('sha256', secret).update(token).digest('base64')}`);
const headersOf = (cookie: string) => new Headers({ cookie });

/** A user (account or guest) with one session row; returns the user id and the signed cookie value. */
async function userWithSession(opts: { anonymous: boolean; expiresInMs?: number; token?: string }): Promise<{ id: string; raw: string; token: string }> {
  const id = randomUUID();
  users.push(id);
  await pool.query(
    `INSERT INTO users (id, name, email, email_verified, is_anonymous, updated_at) VALUES ($1, $2, $3, $4, $5, now())`,
    [id, `eq-${RUN}`, `eq-${RUN}-${id.slice(0, 8)}@t2f.test`, !opts.anonymous, opts.anonymous],
  );
  const token = opts.token ?? randomBytes(24).toString('base64url');
  await pool.query(
    `INSERT INTO user_sessions (token, user_id, expires_at, updated_at) VALUES ($1, $2, now() + ($3::bigint * interval '1 millisecond'), now())`,
    [token, id, String(opts.expiresInMs ?? 3_600_000)],
  );
  return { id, raw: sign(token), token };
}

/** Better Auth's answer as a subject (the same mapping as the slow path of `sessionSubjectOf`). */
async function viaBetterAuth(headers: Headers): Promise<RealtimeSubject | null> {
  const found = await wiring.instance().api.getSession({ headers, query: { disableRefresh: true } });
  if (found === null) return null;
  return { kind: (found.user as { isAnonymous?: unknown }).isAnonymous === true ? 'guest' : 'account', id: found.user.id };
}

/** Fast path first (Better Auth may delete an expired session), then the oracle, then the full resolver. */
async function compare(cookie: string) {
  const headers = headersOf(cookie);
  const fast = await fastSubjectOf(wiring, headers);
  const full = await sessionSubjectOf(wiring, headers);
  const ba = await viaBetterAuth(headers);
  if (fast !== undefined) expect(fast).toEqual(ba);
  expect(full).toEqual(ba);
  return { fast, ba };
}

beforeAll(async () => {
  pool = new pg.Pool({ connectionString: process.env.DATABASE_URI, max: 2 });
  const deps = testDeps({ redis });
  wiring = createAuthWiring({ env: deps.env, getDeps: () => deps, redis, sendOtp: async () => {} });
  deps.auth = wiring;
  secret = (await wiring.instance().$context).secret;
  cookieName = await sessionCookieName(wiring.instance());
});

afterAll(async () => {
  if (users.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
  await pool.end();
  await redis.deleteByPrefix('auth:rl:');
  await redis.close();
});

describe('fast subject read == Better Auth getSession (W5)', () => {
  it('valid account session: the fast path answers, the same subject as Better Auth', async () => {
    const a = await userWithSession({ anonymous: false });
    const r = await compare(`${cookieName}=${a.raw}`);
    expect(r.fast).toEqual({ kind: 'account', id: a.id });
  });

  it('valid guest session issued by Better Auth: the fast path answers, kind guest', async () => {
    const device = randomBytes(16).toString('base64url');
    const h = new Headers({ cookie: `${DEVICE_COOKIE}=${device}` });
    h.set(AUTH_IP_HEADER, ipHeaderValue(`eq-${RUN}-${randomBytes(4).toString('hex')}`));
    const guest = await startGuestSession(wiring, h);
    users.push(guest.id);
    const line = guest.cookies.find((l) => l.startsWith(`${cookieName}=`));
    expect(line).toBeDefined();
    const raw = line!.slice(cookieName.length + 1).split(';')[0]!;
    const r = await compare(`${cookieName}=${raw}`);
    expect(r.fast).toEqual({ kind: 'guest', id: guest.id });
  });

  it('revoked session (row gone): fast path defers, Better Auth says no session', async () => {
    const a = await userWithSession({ anonymous: false });
    await pool.query('DELETE FROM user_sessions WHERE token = $1', [a.token]);
    const r = await compare(`${cookieName}=${a.raw}`);
    expect(r).toEqual({ fast: undefined, ba: null });
  });

  it('expired session: fast path defers, Better Auth says no session', async () => {
    const a = await userWithSession({ anonymous: false, expiresInMs: -60_000 });
    const r = await compare(`${cookieName}=${a.raw}`);
    expect(r).toEqual({ fast: undefined, ba: null });
  });

  it('deleted user (sessions cascade): fast path defers, Better Auth says no session', async () => {
    const a = await userWithSession({ anonymous: true });
    await pool.query('DELETE FROM users WHERE id = $1', [a.id]);
    const r = await compare(`${cookieName}=${a.raw}`);
    expect(r).toEqual({ fast: undefined, ba: null });
  });

  it('bad signature: fast path defers, Better Auth says no session', async () => {
    const a = await userWithSession({ anonymous: false });
    const value = decodeURIComponent(a.raw);
    // Flip the FIRST signature character: the last base64 data character before '=' carries padding bits, so
    // changing it can decode to the same HMAC (the test was flaky in CI 45974443772).
    const dot = value.lastIndexOf('.');
    const flipped = value.slice(0, dot + 1) + (value[dot + 1] === 'A' ? 'B' : 'A') + value.slice(dot + 2);
    const r = await compare(`${cookieName}=${encodeURIComponent(flipped)}`);
    expect(r).toEqual({ fast: undefined, ba: null });
    const otherSecret = encodeURIComponent(`${a.token}.${createHmac('sha256', 'not-the-secret').update(a.token).digest('base64')}`);
    expect(await compare(`${cookieName}=${otherSecret}`)).toEqual({ fast: undefined, ba: null });
  });

  it('duplicate cookie: fast path defers to Better Auth, the resolver answers what Better Auth answers', async () => {
    const a = await userWithSession({ anonymous: false });
    const b = await userWithSession({ anonymous: true });
    const r = await compare(`${cookieName}=${a.raw}; ${cookieName}=${b.raw}`);
    expect(r.fast).toBeUndefined();
    const same = await compare(`${cookieName}=${a.raw}; ${cookieName}=${a.raw}`);
    expect(same.fast).toBeUndefined();
  });

  it('oversized cookie: fast path defers without verifying; a correctly signed long token still resolves via Better Auth', async () => {
    const long = await userWithSession({ anonymous: false, token: 'L'.repeat(SIGNED_COOKIE_MAX) });
    expect(long.raw.length).toBeGreaterThan(SIGNED_COOKIE_MAX);
    const r = await compare(`${cookieName}=${long.raw}`);
    expect(r).toEqual({ fast: undefined, ba: { kind: 'account', id: long.id } });
    const junk = await compare(`${cookieName}=${'x'.repeat(4000)}`);
    expect(junk).toEqual({ fast: undefined, ba: null });
  });

  it('no session cookie: null without any read, as Better Auth', async () => {
    expect(await compare(`${DEVICE_COOKIE}=${randomBytes(16).toString('base64url')}`)).toEqual({ fast: null, ba: null });
  });
});

describe('verified versions of the cookie format', () => {
  it('better-auth 1.7.28 / better-call 1.4.6 — a change means: re-verify the signed cookie format of the fast path', () => {
    const root = fs.realpathSync(path.resolve(__dirname, '../../node_modules/better-auth'));
    const version = (dir: string) => (JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) as { version: string }).version;
    const found = { 'better-auth': version(root), 'better-call': version(path.join(root, '..', 'better-call')) };
    expect(
      found,
      'better-auth or better-call changed: re-verify `verifiedToken` (cookie = encodeURIComponent(`<token>.<base64 HMAC-SHA256(secret, token)>`)), ' +
        'the session join and the expiry check of server/src/adapters/sessionSubjects.ts against the new version, ' +
        'run session-subjects-equivalence.int, then update the versions here.',
    ).toEqual({ 'better-auth': '1.7.28', 'better-call': '1.4.6' });
  });
});
