/**
 * SPEC-06 client transport C7 against the shared Centrifugo through a loopback TCP proxy
 * (AC-41, AC-42 (a), AC-48, AC-49). The web transport is imported as is; its token requests go to the
 * in-process dispatcher, its WebSocket to the proxy. Skips with a line naming Centrifugo when it is
 * unreachable (AC-62). Tokens, the token secret and the API key are never printed.
 */
import { randomBytes } from 'node:crypto';
import type { RealtimeEnvelope } from '@time2fest/contracts';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createRealtimeTransport, type RealtimeFetch } from '../../../lib/api/http/realtime/transport';
import type { ConnectionState, RealtimeTransport } from '../../../lib/api/http/realtime/types';
import { buildDispatcher } from '../../src/container';
import { invalidatorOf, publisherOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { BASE, ownRedis, post, testDeps } from './helpers';
import { startRealtimeProxy, type RealtimeProxy } from './realtime-proxy';
import { describeRealtime, name, realtimeEnv, websocketUrl } from './realtime-support';

type Dispatch = (r: Request) => Promise<Response>;

/** Rate-limit keys of the token endpoint: every in-process request shares the no-address bucket. */
const RL_PREFIX = 'rl:realtime-token:';
/** `history.size` of `site:state` in the channel registry. */
const SITE_HISTORY_SIZE = 10;
/** Proxy pause of AC-41 / AC-42 (the spec's "closed for 3 s"). */
const PAUSE_MS = 3_000;
/** The reconnect delay is random 0.5–20 s with backoff (AC-53): generous waits, not tighter bounds. */
const RECONNECT_WAIT_MS = 25_000;
/** AC-49: anonymous again within 5 s. */
const ANON_RECONNECT_MS = 5_000;

const redis = ownRedis();
const uid = (p: string) => `${p}${randomBytes(6).toString('hex')}`;
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
let proxy: RealtimeProxy;
/** Whether each token response carried a token (`true`) or `token:null` (`false`); values never kept. */
let tokenKinds: boolean[] = [];
const stops: (() => void)[] = [];

/** `fetch` of the transport, served by the dispatcher in this process. */
const tokenFetch: RealtimeFetch = async (input) => {
  const res = await dispatch(new Request(new URL(input, BASE)));
  const body = (await res
    .clone()
    .json()
    .catch(() => undefined)) as { value?: { token?: string | null } } | undefined;
  if (res.ok) tokenKinds.push(typeof body?.value?.token === 'string');
  return res;
};

function openTransport(): RealtimeTransport {
  return createRealtimeTransport({
    url: websocketUrl(`http://127.0.0.1:${proxy.port}`),
    tokenUrl: '/api/realtime/token',
    fetch: tokenFetch,
    loadCentrifuge: () => import('centrifuge'),
  });
}

interface Probe {
  events: RealtimeEnvelope[];
  resyncs: number;
  forbidden: number;
}

function listen(transport: RealtimeTransport, channel: string): Probe {
  const probe: Probe = { events: [], resyncs: 0, forbidden: 0 };
  stops.push(
    transport.subscribe(channel, {
      onEvent: (event) => probe.events.push(event),
      onResync: () => {
        probe.resyncs += 1;
      },
      onForbidden: () => {
        probe.forbidden += 1;
      },
    }),
  );
  return probe;
}

const ids = (probe: Probe) => probe.events.map((e) => e.id);
const siteEnvelope = (n: number): RealtimeEnvelope => ({ type: 'site.state', id: uid('ev_'), data: { n } });

/** Publishes into `site:state` through the server port (unbatched class → `ok`). */
async function publishSite(n: number): Promise<RealtimeEnvelope> {
  const envelope = siteEnvelope(n);
  expect((await publisherOf(deps).publish('site:state', undefined, envelope)).status).toBe('ok');
  return envelope;
}

/** Proves the subscription is live: a published event reaches the probe. */
async function delivered(probe: Probe, envelope: RealtimeEnvelope, ms = 10_000): Promise<boolean> {
  return waitFor(() => ids(probe).includes(envelope.id), ms);
}

describeRealtime('client transport against Centrifugo through a proxy', () => {
  beforeAll(async () => {
    deps = testDeps({ redis });
    dispatch = await buildDispatcher(deps);
    proxy = await startRealtimeProxy(realtimeEnv.url ?? '');
  });

  beforeEach(async () => {
    tokenKinds = [];
    await redis.deleteByPrefix(RL_PREFIX);
  });

  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
    proxy.pause(0);
  });

  afterAll(async () => {
    await proxy.close();
    await redis.deleteByPrefix(RL_PREFIX);
    await redis.close();
  });

  it('AC-48: token:null → anonymous connect, site:state subscribed and delivered', async () => {
    const transport = openTransport();
    const probe = listen(transport, name('site:state'));
    expect(await waitFor(() => transport.state() === 'connected', 10_000)).toBe(true);
    // A publish may race the subscribe: publish until one arrives.
    let arrived = false;
    for (let i = 0; i < 5 && !arrived; i += 1) arrived = await delivered(probe, await publishSite(0), 2_000);
    expect(arrived).toBe(true);
    expect(tokenKinds.length).toBeGreaterThan(0);
    expect(tokenKinds.every((hasToken) => !hasToken)).toBe(true);
    expect(probe.resyncs).toBe(0);
  });

  it('AC-41: drop + 3 s pause, 5 events meanwhile → all 5 in order after reconnect, no resync', { timeout: 60_000 }, async () => {
    const transport = openTransport();
    const probe = listen(transport, name('site:state'));
    let arrived = false;
    for (let i = 0; i < 5 && !arrived; i += 1) arrived = await delivered(probe, await publishSite(0), 2_000);
    expect(arrived).toBe(true);
    const before = probe.events.length;

    proxy.pause(PAUSE_MS);
    proxy.drop();
    const missed: RealtimeEnvelope[] = [];
    for (let n = 1; n <= 5; n += 1) missed.push(await publishSite(n));
    expect(await waitFor(() => transport.state() !== 'connected', 2_000)).toBe(true);

    expect(await delivered(probe, missed[4] as RealtimeEnvelope, RECONNECT_WAIT_MS)).toBe(true);
    await sleep(500);
    expect(transport.state()).toBe('connected');
    expect(probe.events.slice(before).map((e) => e.id)).toEqual(missed.map((e) => e.id));
    expect(probe.resyncs).toBe(0);
  });

  it('AC-42 (a): history_size + 1 events during the pause → one onResync, none of them delivered', { timeout: 60_000 }, async () => {
    const transport = openTransport();
    const probe = listen(transport, name('site:state'));
    let arrived = false;
    for (let i = 0; i < 5 && !arrived; i += 1) arrived = await delivered(probe, await publishSite(0), 2_000);
    expect(arrived).toBe(true);
    const before = probe.events.length;

    proxy.pause(PAUSE_MS);
    proxy.drop();
    const missed: string[] = [];
    for (let n = 1; n <= SITE_HISTORY_SIZE + 1; n += 1) missed.push((await publishSite(n)).id);
    expect(await waitFor(() => transport.state() !== 'connected', 2_000)).toBe(true);

    expect(await waitFor(() => probe.resyncs > 0, RECONNECT_WAIT_MS)).toBe(true);
    await sleep(1_500);
    expect(probe.resyncs).toBe(1);
    expect(probe.events.slice(before).map((e) => e.id).filter((id) => missed.includes(id))).toEqual([]);
    // The channel is live again after the resync.
    expect(await delivered(probe, await publishSite(99))).toBe(true);
  });

  it('AC-49: the subject is reset and invalidated → anonymous within 5 s, public kept, personal onForbidden', { timeout: 180_000 }, async () => {
    const subject = uid('g');
    expect((await dispatch(post('/api/_test/realtime-token', { subject: { kind: 'guest', id: subject } }))).status).toBe(200);
    const transport = openTransport();
    const pub = listen(transport, name('site:state'));
    const own = listen(transport, name('user', subject));
    let arrived = false;
    for (let i = 0; i < 5 && !arrived; i += 1) arrived = await delivered(pub, await publishSite(0), 2_000);
    expect(arrived).toBe(true);
    const personal: RealtimeEnvelope = { type: 'user.test', id: uid('ev_') };
    expect((await publisherOf(deps).publish('user', subject, personal)).status).toBe('ok');
    expect(await delivered(own, personal)).toBe(true);
    expect(tokenKinds.length).toBeGreaterThan(0);
    expect(tokenKinds.every((hasToken) => hasToken)).toBe(true);

    expect((await dispatch(post('/api/_test/reset', {}))).status).toBe(200);
    await redis.deleteByPrefix(RL_PREFIX);
    const states: { state: ConnectionState; at: number }[] = [];
    stops.push(transport.onStateChange((state) => states.push({ state, at: performance.now() })));
    const startedAt = performance.now();
    expect(await invalidatorOf(deps).invalidate(subject)).toBe('ok');

    expect(
      await waitFor(
        () => states.some((s) => s.state === 'connecting') && transport.state() === 'connected' && own.forbidden > 0,
        RECONNECT_WAIT_MS,
      ),
    ).toBe(true);
    const reconnectedAt = states.filter((s) => s.state === 'connected').at(-1)?.at ?? Number.POSITIVE_INFINITY;
    expect(reconnectedAt - startedAt).toBeLessThanOrEqual(ANON_RECONNECT_MS);
    expect(tokenKinds.at(-1)).toBe(false);
    expect(own.forbidden).toBe(1);
    expect(await delivered(pub, await publishSite(1))).toBe(true);
  });
});
