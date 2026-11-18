/**
 * SPEC-06 C1 and the realtime test door (AC-12, AC-13, AC-15, AC-16, AC-19, AC-57 … AC-60, AC-62)
 * against this worktree's Redis and, for the connection, the shared Centrifugo. Only the connection
 * needs Centrifugo; that block skips with a line naming Centrifugo when it is unreachable (AC-62).
 * Tokens are never printed.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { BASE, ownRedis, post, testDeps } from './helpers';
import { centrifugeClient, centrifugoProbe, connectAndWait, describeRealtime, realtimeEnv } from './realtime-support';

type Dispatch = (r: Request) => Promise<Response>;
type TokenBody = { ok: true; value: { token: string | null; expiresAt: string | null } };
type ErrorBody = { ok: false; error: { code: string; reason?: string; retryAfterMs?: number } };

const RL_PREFIX = 'rl:realtime-token:';
// Built at runtime (40 hex characters): no secret-looking literal in the test.
const EDGE_SECRET = randomBytes(20).toString('hex');
const redis = ownRedis();

const getToken = (dispatch: Dispatch, headers: Record<string, string> = {}) =>
  dispatch(new Request(`${BASE}/api/realtime/token`, { headers }));

async function tokenValue(dispatch: Dispatch): Promise<TokenBody['value']> {
  const res = await getToken(dispatch);
  expect(res.status).toBe(200);
  return ((await res.json()) as TokenBody).value;
}

const setSubject = (dispatch: Dispatch, id: string) =>
  dispatch(post('/api/_test/realtime-token', { subject: { kind: 'guest', id } }));

function decode(part: string | undefined): Record<string, unknown> {
  return JSON.parse(Buffer.from(part ?? '', 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function shape(res: Response) {
  const headers = [...res.headers.entries()].filter(([k]) => k !== 'date').sort();
  return { status: res.status, body: await res.text(), headers };
}

let deps: Deps;
let dispatch: Dispatch;

beforeAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  deps = testDeps({ redis });
  dispatch = await buildDispatcher(deps);
});

afterAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  await redis.close();
});

describe('GET /api/realtime/token and the realtime test door', () => {
  it('AC-13: without a door subject → {token:null, expiresAt:null}', async () => {
    // The door module is evaluated per test file, so no subject is set yet.
    expect(await tokenValue(dispatch)).toEqual({ token: null, expiresAt: null });
  });

  it('AC-57, AC-12: the door returns a token and sets the subject; GET signs HS256 with sub/iat/exp only', async () => {
    const door = await setSubject(dispatch, 'g1');
    expect(door.status).toBe(200);
    const fromDoor = ((await door.json()) as TokenBody).value;
    expect(typeof fromDoor.token).toBe('string');
    expect(decode(fromDoor.token?.split('.')[1]).sub).toBe('g1');

    const value = await tokenValue(dispatch);
    const [header, payload] = (value.token ?? '').split('.');
    expect(decode(header).alg).toBe('HS256');
    const claims = decode(payload);
    expect(Object.keys(claims).sort()).toEqual(['exp', 'iat', 'sub']);
    expect(claims.sub).toBe('g1');
    expect(value.expiresAt).toBe(new Date((claims.exp as number) * 1000).toISOString());
  });

  it('AC-15: a foreign Origin → private, no-store and no Access-Control-* header', async () => {
    const res = await getToken(dispatch, { origin: 'https://evil.example' });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
    expect([...res.headers.keys()].filter((k) => k.startsWith('access-control-'))).toEqual([]);
  });

  it('AC-58: POST /api/_test/reset forgets the subject → token:null', { timeout: 120_000 }, async () => {
    expect((await setSubject(dispatch, 'g2')).status).toBe(200);
    expect((await tokenValue(dispatch)).token).not.toBeNull();
    expect((await dispatch(post('/api/_test/reset', {}))).status).toBe(200);
    expect(await tokenValue(dispatch)).toEqual({ token: null, expiresAt: null });
  });

  it('AC-16: the 31st request of one client within a minute → 429 rate_limited with retryAfterMs', async () => {
    await redis.deleteByPrefix(RL_PREFIX);
    const edged = await buildDispatcher(testDeps({ redis }, { T2F_EDGE_SECRET: EDGE_SECRET }));
    const client = { 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': '203.0.113.77;UA' };
    const statuses: number[] = [];
    let last: Response | undefined;
    for (let i = 0; i < 31; i += 1) {
      last = await getToken(edged, client);
      statuses.push(last.status);
    }
    expect(statuses.slice(0, 30).every((s) => s === 200)).toBe(true);
    expect(statuses[30]).toBe(429);
    const body = (await (last as Response).json()) as ErrorBody;
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
  });

  it('AC-19: test class without T2F_CENTRIFUGO_TOKEN_SECRET → 503 realtime-not-configured', async () => {
    const bare = await buildDispatcher(testDeps({ redis }, { T2F_CENTRIFUGO_TOKEN_SECRET: undefined }));
    const res = await getToken(bare);
    expect(res.status).toBe(503);
    const body = (await res.json()) as ErrorBody;
    expect(body.error).toEqual({ code: 'unavailable', reason: 'realtime-not-configured' });
  });

  it('AC-59: outside test + doors the door path answers the unknown-path 404', async () => {
    const door = () =>
      new Request(`${BASE}/api/_test/realtime-token`, {
        method: 'POST',
        body: JSON.stringify({ subject: { kind: 'guest', id: 'g3' } }),
        headers: { 'content-type': 'application/json', 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': '203.0.113.78;UA' },
      });
    const nope = () => new Request(`${BASE}/api/nope`, { headers: { 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': '203.0.113.78;UA' } });
    // SPEC-13a S4: a production-class env carries production's conventional names (never connected here).
    const productionNames = {
      DATABASE_URI: 'postgres://t2f@127.0.0.1:5432/t2f_production',
      T2F_REDIS_PREFIX: 't2f:production:',
      T2F_R2_BUCKET: 'time2fest-prod',
    };
    const production = await buildDispatcher(
      testDeps({ redis }, { T2F_ENV: 'production', T2F_EDGE_SECRET: EDGE_SECRET, ...productionNames }),
    );
    const noDoors = await buildDispatcher(testDeps({ redis }, { T2F_TEST_DOORS: undefined }));
    for (const d of [production, noDoors]) {
      const unknown = await shape(await d(nope()));
      expect(unknown.status).toBe(404);
      expect(await shape(await d(door()))).toEqual(unknown);
    }
  });

  it('AC-62: the probe of an unreachable Centrifugo is not ready and names Centrifugo', async () => {
    const probe = await centrifugoProbe('http://127.0.0.1:1', randomBytes(16).toString('hex'), realtimeEnv.prefix);
    expect(probe.ready).toBe(false);
    expect(probe.ready ? '' : probe.message).toContain('Centrifugo');
  });
});

describeRealtime('realtime token against Centrifugo', () => {
  it('AC-12, AC-60: the endpoint token connects (the .env.local secret equals Centrifugo’s)', async () => {
    expect((await setSubject(dispatch, 'g4')).status).toBe(200);
    const { token } = await tokenValue(dispatch);
    expect(token).not.toBeNull();
    const client = centrifugeClient(token);
    try {
      expect(await connectAndWait(client)).toBe('connected');
    } finally {
      client.disconnect();
    }
  });
});
