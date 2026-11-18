/**
 * SPEC-06 publish port and `invalidateSubject` against the shared Centrifugo (AC-9, AC-17, AC-30, AC-32,
 * AC-33, AC-35, AC-36, NFR-5). Both ports come from `testDeps()` through `publisherOf`/`invalidatorOf`.
 * The closed-port cases need no Centrifugo; the rest skip with a line naming Centrifugo when it is
 * unreachable (AC-62). Tokens, the token secret and the API key are never printed.
 */
import { randomBytes } from 'node:crypto';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher } from '../../src/container';
import { invalidatorOf, publisherOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { BASE, ownRedis, post, testDeps } from './helpers';
import { centrifugeClient, connectAndWait, describeRealtime, name, realtimeEnv } from './realtime-support';

type Dispatch = (r: Request) => Promise<Response>;
type TokenBody = { ok: true; value: { token: string | null; expiresAt: string | null } };

const RL_PREFIX = 'rl:realtime-token:';
/** Slot 12's closed fake port: nothing listens there while this file runs. */
const CLOSED_URL = 'http://127.0.0.1:4125';
/** Centrifugo's own Redis database: 63 on the local stack, 15 in CI (step env). */
const CENTRIFUGO_REDIS_DB = Number(process.env.T2F_TEST_CENTRIFUGO_REDIS_DB ?? 63);
const CENTRIFUGO_REDIS_PREFIX = 't2f_centrifugo';

const redis = ownRedis();
const lines: { level: string; fields: Record<string, unknown> }[] = [];
const capture = {
  info: (fields: Record<string, unknown>) => lines.push({ level: 'info', fields }),
  warn: (fields: Record<string, unknown>) => lines.push({ level: 'warn', fields }),
  error: (fields: Record<string, unknown>) => lines.push({ level: 'error', fields }),
};

const uid = (p: string) => `${p}${randomBytes(6).toString('hex')}`;
const envelope = (data: unknown = { phase: 'live' }): RealtimeEnvelope => ({ type: 'site.state', id: uid('ev_'), version: 1, data });

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (pred()) return true;
    await new Promise((r) => setTimeout(r, 20));
  }
  return pred();
}

/** A Redis client on `db` of the stack Redis (host and port of this slot's `REDIS_URL`). */
function redisDb(db: number): Redis {
  const url = new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380/0');
  url.pathname = `/${db}`;
  return new Redis(url.toString(), { lazyConnect: true, maxRetriesPerRequest: 1 });
}

let deps: Deps;
let closed: Deps;
let dispatch: Dispatch;

beforeAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  deps = testDeps({ redis, log: capture });
  // The API key is read from the environment; a random one is enough against a closed port.
  closed = testDeps(
    { redis, log: capture },
    { T2F_CENTRIFUGO_URL: CLOSED_URL, T2F_CENTRIFUGO_API_KEY: realtimeEnv.apiKey ?? randomBytes(24).toString('hex') },
  );
  dispatch = await buildDispatcher(deps);
});

afterAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  await redis.close();
});

describe('publish and invalidate with Centrifugo down (closed port)', () => {
  it('AC-32, NFR-5: publish → unavailable within 2 s, no throw, one warn line with the class and no body', async () => {
    const from = lines.length;
    const env = envelope({ secretish: 'body-marker' });
    const t0 = performance.now();
    const result = await publisherOf(closed).publish('site:state', undefined, env);
    expect(performance.now() - t0).toBeLessThanOrEqual(2_000);
    expect(result).toEqual({ status: 'unavailable' });
    const warns = lines.slice(from).filter((l) => l.level === 'warn');
    expect(warns).toEqual([{ level: 'warn', fields: { event: 'realtime_publish', class: 'site:state', events: 1, result: 'unavailable' } }]);
    expect(JSON.stringify(lines.slice(from))).not.toContain('body-marker');
  });

  it('AC-36, NFR-5: invalidate → unavailable within 2 s and one warn line with the subject id', async () => {
    const from = lines.length;
    const subject = uid('s_');
    const t0 = performance.now();
    const result = await invalidatorOf(closed).invalidate(subject);
    expect(performance.now() - t0).toBeLessThanOrEqual(2_000);
    expect(result).toBe('unavailable');
    expect(lines.slice(from).filter((l) => l.level === 'warn')).toEqual([
      { level: 'warn', fields: { event: 'realtime_invalidate', subject, result: 'unavailable' } },
    ]);
  });
});

describeRealtime('publish and invalidate against Centrifugo', () => {
  const setSubject = async (id: string): Promise<string> => {
    const res = await dispatch(post('/api/_test/realtime-token', { subject: { kind: 'guest', id } }));
    expect(res.status).toBe(200);
    const { token } = ((await res.json()) as TokenBody).value;
    expect(token).not.toBeNull();
    return token as string;
  };

  /** An anonymous client subscribed to `site:state`, collecting every publication. */
  async function siteSubscriber(): Promise<{ client: Centrifuge; got: { at: number; data: unknown }[] }> {
    const client = centrifugeClient(null);
    const got: { at: number; data: unknown }[] = [];
    expect(await connectAndWait(client)).toBe('connected');
    const sub = client.newSubscription(name('site:state'));
    sub.on('publication', (ctx: PublicationContext) => got.push({ at: performance.now(), data: ctx.data }));
    const subscribed = new Promise<void>((resolve) => sub.once('subscribed', () => resolve()));
    sub.subscribe();
    await subscribed;
    return { client, got };
  }

  it('AC-30: an anonymous site:state subscriber receives exactly the envelope within 1 s', async () => {
    const { client, got } = await siteSubscriber();
    try {
      const env = envelope({ phase: 'live', zones: ['UTC+14'], n: 3 });
      const t0 = performance.now();
      const result = await publisherOf(deps).publish('site:state', undefined, env);
      expect(result.status).toBe('ok');
      expect(await waitFor(() => got.some((g) => (g.data as RealtimeEnvelope).id === env.id), 1_000)).toBe(true);
      const hit = got.find((g) => (g.data as RealtimeEnvelope).id === env.id);
      expect((hit?.at ?? Infinity) - t0).toBeLessThanOrEqual(1_000);
      expect(hit?.data).toEqual(env);
    } finally {
      client.disconnect();
    }
  });

  it('AC-33: the same id published twice → one publication within 2 s', async () => {
    const { client, got } = await siteSubscriber();
    try {
      const env = envelope();
      expect((await publisherOf(deps).publish('site:state', undefined, env)).status).toBe('ok');
      expect((await publisherOf(deps).publish('site:state', undefined, env)).status).toBe('ok');
      await new Promise((r) => setTimeout(r, 2_000));
      expect(got.filter((g) => (g.data as RealtimeEnvelope).id === env.id)).toHaveLength(1);
    } finally {
      client.disconnect();
    }
  });

  it('AC-35: invalidate(S) → both S connections get 3014 within 2 s; T stays connected', async () => {
    const s = uid('s_');
    const t = uid('t_');
    const tokenS = await setSubject(s);
    const tokenT = await setSubject(t);
    const clients = [centrifugeClient(tokenS), centrifugeClient(tokenS), centrifugeClient(tokenT)];
    const codes: number[][] = clients.map(() => []);
    try {
      for (const c of clients) expect(await connectAndWait(c)).toBe('connected');
      clients.forEach((c, i) => {
        c.on('connecting', (ctx) => codes[i]?.push(ctx.code));
        c.on('disconnected', (ctx) => codes[i]?.push(ctx.code));
      });
      const t0 = performance.now();
      expect(await invalidatorOf(deps).invalidate(s)).toBe('ok');
      expect(await waitFor(() => codes[0]?.includes(3014) === true && codes[1]?.includes(3014) === true, 2_000)).toBe(true);
      expect(performance.now() - t0).toBeLessThanOrEqual(2_000);
      expect(codes[2]).toEqual([]);
      expect(String(clients[2]?.state)).toBe('connected');
    } finally {
      for (const c of clients) c.disconnect();
    }
  });

  it('AC-9: Centrifugo keeps its keys in its own Redis database, none in this slot', async () => {
    expect((await publisherOf(deps).publish('site:state', undefined, envelope())).status).toBe('ok');
    const slotDb = Number(new URL(process.env.REDIS_URL ?? 'redis://127.0.0.1:6380/0').pathname.slice(1) || 0);
    expect(slotDb).not.toBe(CENTRIFUGO_REDIS_DB);
    const own = redisDb(CENTRIFUGO_REDIS_DB);
    const slot = redisDb(slotDb);
    try {
      expect((await own.keys(`${CENTRIFUGO_REDIS_PREFIX}*`)).length).toBeGreaterThan(0);
      expect(await slot.keys(`${CENTRIFUGO_REDIS_PREFIX}*`)).toEqual([]);
    } finally {
      own.disconnect();
      slot.disconnect();
    }
  });

  it('AC-17: no captured line holds the token, the token secret or the API key', async () => {
    await setSubject(uid('g_'));
    const res = await dispatch(new Request(`${BASE}/api/realtime/token`));
    expect(res.status).toBe(200);
    const { token } = ((await res.json()) as TokenBody).value;
    expect(await publisherOf(deps).publish('site:state', undefined, envelope())).toMatchObject({ status: 'ok' });
    expect(await invalidatorOf(deps).invalidate(uid('s_'))).toBe('ok');
    // The closed port adds warn lines, so the capture is never vacuous.
    await publisherOf(closed).publish('site:state', undefined, envelope());
    await invalidatorOf(closed).invalidate(uid('s_'));
    expect(lines.filter((l) => l.level === 'warn').length).toBeGreaterThan(0);

    const all = JSON.stringify(lines);
    const secrets = [token, process.env.T2F_CENTRIFUGO_TOKEN_SECRET, process.env.T2F_CENTRIFUGO_API_KEY];
    for (const secret of secrets) {
      expect(secret).toBeTruthy();
      expect(all.includes(secret as string)).toBe(false);
    }
  });
});
