/**
 * SPEC-06 channel permissions against the shared Centrifugo with the env-only configuration
 * (AC-21 … AC-29): client publish refused, anonymous only on public classes, a subject only on its own
 * personal channels, unknown namespaces refused, foreign Origin refused, foreign-key and expired tokens
 * refused, the server API closed without its key. Skips with a line naming Centrifugo when it is
 * unreachable (AC-62). Tokens, the token secret and the API key are never printed.
 */
import { createHmac, randomBytes } from 'node:crypto';
import { request } from 'node:http';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { Centrifuge, type PublicationContext, type Subscription } from 'centrifuge';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { buildDispatcher } from '../../src/container';
import { publisherOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { channelRegistry } from '../../src/registries/channels';
import { ownRedis, post, testDeps } from './helpers';
import {
  centrifugeClient,
  connectAndWait,
  describeRealtime,
  name,
  realtimeEnv,
  websocketUrl,
} from './realtime-support';

type Dispatch = (r: Request) => Promise<Response>;
type TokenBody = { ok: true; value: { token: string | null; expiresAt: string | null } };

const redis = ownRedis();
const uid = (p: string) => `${p}${randomBytes(6).toString('hex')}`;
const envelope = (): RealtimeEnvelope => ({
  type: 'site.state',
  id: uid('ev_'),
  version: 1,
  data: { phase: 'live' },
});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(20);
  }
  return pred();
}

let deps: Deps;
let dispatch: Dispatch;
const clients: Centrifuge[] = [];

beforeAll(async () => {
  deps = testDeps({ redis });
  dispatch = await buildDispatcher(deps);
});

afterAll(async () => {
  for (const c of clients) c.disconnect();
  await redis.close();
});

async function doorToken(id: string, ttlSeconds?: number): Promise<string> {
  const res = await dispatch(
    post('/api/_test/realtime-token', {
      subject: { kind: 'guest', id },
      ...(ttlSeconds ? { ttlSeconds } : {}),
    }),
  );
  expect(res.status).toBe(200);
  const { token } = ((await res.json()) as TokenBody).value;
  expect(token).not.toBeNull();
  return token as string;
}

async function connected(token: string | null): Promise<Centrifuge> {
  const client = centrifugeClient(token);
  clients.push(client);
  expect(await connectAndWait(client)).toBe('connected');
  return client;
}

type Outcome = { state: 'subscribed' } | { state: 'refused'; code: number };

/** Subscribes and settles on `subscribed` or the refusing error code. */
function subscribe(
  client: Centrifuge,
  channel: string,
  onPublication?: (ctx: PublicationContext) => void,
): Promise<{ sub: Subscription; outcome: Outcome }> {
  return new Promise((resolve) => {
    const sub = client.newSubscription(channel);
    if (onPublication) sub.on('publication', onPublication);
    sub.once('subscribed', () => resolve({ sub, outcome: { state: 'subscribed' } }));
    sub.once('error', (ctx) =>
      resolve({ sub, outcome: { state: 'refused', code: ctx.error.code } }),
    );
    sub.once('unsubscribed', (ctx) =>
      resolve({ sub, outcome: { state: 'refused', code: ctx.code } }),
    );
    sub.subscribe();
  });
}

/** One sample key per class (personal classes take the subject id, keyed ones a valid name). */
function sampleKey(classKey: string, subject: string): string | undefined {
  const row = channelRegistry.find((r) => r.key === classKey);
  if (row === undefined) throw new Error(`no class ${classKey}`);
  if (row.shape === 'personal') return subject;
  if (row.shape === 'keyed') return classKey === 'chat:country' ? 'UA' : 'x1';
  return undefined;
}

const PERSONAL = ['notif', 'orders', 'user'] as const;
const PUBLIC = channelRegistry
  .filter((r) => r.visibility === 'public' && r.key !== 'rttest')
  .map((r) => r.key);

describeRealtime('channel permissions against Centrifugo', () => {
  it('AC-21: a client publish is refused with 103 on every class and nothing is delivered', async () => {
    const a = uid('pa');
    const c1 = await connected(await doorToken(a));
    const c2 = await connected(await doorToken(a));
    const got: string[] = [];
    const refusals: { cls: string; code: number | undefined }[] = [];
    const subs: { cls: string; sub: Subscription }[] = [];
    for (const row of channelRegistry) {
      const channel = name(row.key, sampleKey(row.key, a));
      const s1 = await subscribe(c1, channel);
      const s2 = await subscribe(c2, channel, () => got.push(row.key));
      expect(s1.outcome, `${row.key} subscribe (c1)`).toEqual({ state: 'subscribed' });
      expect(s2.outcome, `${row.key} subscribe (c2)`).toEqual({ state: 'subscribed' });
      subs.push({ cls: row.key, sub: s1.sub });
    }
    for (const { cls, sub } of subs) {
      await sub.publish({ forged: true }).then(
        () => refusals.push({ cls, code: undefined }),
        (err: { code?: number }) => refusals.push({ cls, code: err.code }),
      );
    }
    await sleep(2_000);
    expect(refusals).toEqual(channelRegistry.map((r) => ({ cls: r.key, code: 103 })));
    expect(got).toEqual([]);
  });

  it('AC-22: anonymous → the three personal channels of a subject → 103', async () => {
    const client = await connected(null);
    for (const cls of PERSONAL) {
      const { outcome } = await subscribe(client, name(cls, 'pa1'));
      expect(outcome, cls).toEqual({ state: 'refused', code: 103 });
    }
  });

  it('AC-23: sub A → the three channels of B → 103, also with a prefix-qualified name', async () => {
    const a = uid('pa');
    const b = uid('pb');
    const client = await connected(await doorToken(a));
    for (const cls of PERSONAL) {
      const { outcome } = await subscribe(client, name(cls, b));
      expect(outcome, cls).toEqual({ state: 'refused', code: 103 });
    }
    // A multi-user name that does not list A is refused too.
    const row = channelRegistry.find((r) => r.key === 'notif');
    const crafted = `${row?.namespace}:${realtimeEnv.prefix}user#${b},${uid('pc')}`;
    expect((await subscribe(client, crafted)).outcome).toEqual({ state: 'refused', code: 103 });
  });

  it('AC-24: sub A → own three channels subscribed, and a server publish through the port arrives', async () => {
    const a = uid('pa');
    const client = await connected(await doorToken(a));
    const got: Record<string, RealtimeEnvelope[]> = {};
    for (const cls of PERSONAL) {
      const { outcome } = await subscribe(client, name(cls, a), (ctx) =>
        (got[cls] ??= []).push(ctx.data as RealtimeEnvelope),
      );
      expect(outcome, cls).toEqual({ state: 'subscribed' });
    }
    for (const cls of PERSONAL) {
      const env = envelope();
      expect((await publisherOf(deps).publish(cls, a, env)).status).toBe('ok');
      expect(await waitFor(() => (got[cls] ?? []).some((e) => e.id === env.id), 2_000), cls).toBe(
        true,
      );
    }
  });

  it('AC-25: anonymous → every public class subscribed and delivered', async () => {
    const client = await connected(null);
    const got: Record<string, string[]> = {};
    for (const cls of PUBLIC) {
      const key = sampleKey(cls, 'x');
      const { outcome } = await subscribe(client, name(cls, key), (ctx) =>
        (got[cls] ??= []).push((ctx.data as RealtimeEnvelope).id),
      );
      expect(outcome, cls).toEqual({ state: 'subscribed' });
    }
    for (const cls of PUBLIC) {
      const env = envelope();
      expect((await publisherOf(deps).publish(cls, sampleKey(cls, 'x'), env)).status, cls).toBe(
        'ok',
      );
      expect(await waitFor(() => (got[cls] ?? []).includes(env.id), 2_000), cls).toBe(true);
    }
  });

  it('AC-26: an unknown namespace → 102', async () => {
    const client = await connected(null);
    for (const channel of [`admin:${realtimeEnv.prefix}x`, `rttest2:${realtimeEnv.prefix}x`]) {
      expect((await subscribe(client, channel)).outcome, channel).toEqual({
        state: 'refused',
        code: 102,
      });
    }
  });

  it('AC-27: a WebSocket upgrade with a foreign Origin is refused with 403', async () => {
    const url = new URL(websocketUrl().replace(/^ws/, 'http'));
    const status = await new Promise<number>((resolve, reject) => {
      const req = request({
        host: url.hostname,
        port: url.port,
        path: url.pathname,
        headers: {
          Connection: 'Upgrade',
          Upgrade: 'websocket',
          Origin: 'https://evil.example',
          'Sec-WebSocket-Version': '13',
          'Sec-WebSocket-Key': randomBytes(16).toString('base64'),
          'Sec-WebSocket-Protocol': 'centrifuge-json',
        },
      });
      req.on('response', (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on('upgrade', (res, socket) => {
        socket.destroy();
        resolve(res.statusCode ?? 0);
      });
      req.on('error', reject);
      req.end();
    });
    expect(status).toBe(403);
  });

  it('AC-28: a token of a foreign key and an expired door token are refused', async () => {
    const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const head = b64({ alg: 'HS256', typ: 'JWT' });
    const body = b64({ sub: uid('pa'), iat: now, exp: now + 600 });
    // 64 random characters: neither the stand's secret nor any literal in the repository.
    const foreignKey = randomBytes(32).toString('hex');
    const forged = `${head}.${body}.${createHmac('sha256', foreignKey).update(`${head}.${body}`).digest('base64url')}`;
    const c1 = centrifugeClient(forged);
    clients.push(c1);
    expect(await connectAndWait(c1)).toBe('disconnected');

    const expired = await doorToken(uid('pa'), 1);
    await sleep(2_100);
    const c2 = centrifugeClient(expired);
    clients.push(c2);
    expect(await connectAndWait(c2)).toBe('disconnected');
  });

  it('AC-29: POST /api/publish without a key and with a wrong key → 401 and nothing is delivered', async () => {
    const client = await connected(null);
    const got: unknown[] = [];
    const channel = name('site:state');
    expect((await subscribe(client, channel, (ctx) => got.push(ctx.data))).outcome).toEqual({
      state: 'subscribed',
    });
    const wrong = randomBytes(24).toString('hex');
    const attempts: Record<string, string>[] = [
      {},
      { 'x-api-key': wrong },
      { authorization: `apikey ${wrong}` },
    ];
    for (const headers of attempts) {
      const res = await fetch(`${realtimeEnv.url}/api/publish`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ channel, data: { forged: true } }),
      });
      expect(res.status).toBe(401);
    }
    await sleep(1_000);
    expect(got).toEqual([]);
  });
});
