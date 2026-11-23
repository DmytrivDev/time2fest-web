/**
 * Viewers against the local Centrifugo, the `_test` database and Redis (SPEC-12 AC-59 … AC-63; W28).
 * Tokens come from the real dispatcher (`GET /api/live/viewer-token` with the edge secret and `x-t2f-client`, one
 * client address per request); Node `centrifuge` clients connect anonymously and subscribe to `live:viewers` with
 * those tokens (the lock-holder tab) or without one (a second tab). The aggregator under test is the production one
 * (`createViewersAggregator`) over the real presence API, with a clock that can skip the 30 s cache and a fixed
 * viewer catalog; the switches are the real site record. Addresses are TEST-NET-2 (198.51.100.0/24).
 * - AC-59: `UA`, `XX`, no client header → only `UA` counted as a country (all three are people).
 * - AC-60: 3×PL + 2×DE → `[PL]`; two `live:viewers` events of the ticker 30–60 s apart.
 * - AC-61: 3 token subscriptions + 1 tokenless second tab → `people: 3`; one browser closes → 2 within 60 s.
 * - AC-62: the four combinations of `viewersMap` × `viewersCount`, through `GET /api/live/viewers`.
 * - AC-63: after 100 subscriptions no test address or client id is in any database table (journal included) or in
 *   the captured server log; a new aggregator starts from zero.
 */
import { randomBytes } from 'node:crypto';
import type { Centrifuge, PublicationContext, Subscription } from 'centrifuge';
import type { Payload } from 'payload';
import { afterAll, afterEach, beforeAll, expect, it } from 'vitest';
import type { SiteSwitches, ViewerSummary } from '@time2fest/contracts';
import { createCentrifugoApi } from '../../src/adapters/centrifugoApi';
import { buildDispatcher, payloadOf, startViewersTicker } from '../../src/container';
import type { ViewerCatalogCountry } from '../../src/domain/live/viewers';
import { liveOf, siteOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { createViewersAggregator, VIEWERS_PASS_MS, type ViewersAggregator } from '../../src/live/viewers';
import { BASE, ownRedis, testDeps } from './helpers';
import { centrifugeClient, connectAndWait, describeRealtime, name, realtimeEnv } from './realtime-support';

const SEC = 1_000;
// Built at runtime: no secret-looking literal in the test.
const EDGE_SECRET = randomBytes(20).toString('hex');
const RL_PREFIX = 'rl:live-viewer-token:';
const CHANNEL = name('live:viewers');

const CATALOG: ViewerCatalogCountry[] = [
  { iso: 'UA', name: 'Україна', flagCode: 'ua', popularity: 100 },
  { iso: 'PL', name: 'Польща', flagCode: 'pl', popularity: 90 },
  { iso: 'DE', name: 'Німеччина', flagCode: 'de', popularity: 80 },
];

type Dispatch = (r: Request) => Promise<Response>;

const redis = ownRedis();
const logLines: string[] = [];
const capture = {
  info: (f: Record<string, unknown>) => logLines.push(JSON.stringify(f)),
  warn: (f: Record<string, unknown>) => logLines.push(JSON.stringify(f)),
  error: (f: Record<string, unknown>) => logLines.push(JSON.stringify(f)),
};
let deps: Deps;
let payload: Payload;
let dispatch: Dispatch;
let skew = 0;
const clock = { now: () => Date.now() + skew };
const clients: Centrifuge[] = [];
const clientIds: string[] = [];
const addresses: string[] = [];
let ipSeq = 0;

function aggregator(minPerCountry?: number): ViewersAggregator {
  const live = liveOf(deps);
  const site = siteOf(deps);
  return createViewersAggregator({
    presence: createCentrifugoApi({ url: realtimeEnv.url ?? '', apiKey: realtimeEnv.apiKey ?? '', log: capture }),
    channel: CHANNEL,
    lease: live.lease,
    ...(deps.realtime?.publisher !== undefined ? { publisher: deps.realtime.publisher } : {}),
    switches: async () => (await site.store.read()).switches,
    countries: async () => CATALOG,
    cfg: minPerCountry === undefined ? live.cfg : { ...live.cfg, viewersMinPerCountry: minPerCountry },
    clock,
  });
}

/** The current summary, past the 30 s cache. */
async function fresh(agg: ViewersAggregator): Promise<ViewerSummary> {
  skew += VIEWERS_PASS_MS;
  const read = await agg.current();
  if (!read.ok) throw new Error('presence did not answer');
  return read.summary;
}

/** A viewer token for a request from `country` (`undefined` → no `x-t2f-client` header at all). */
async function viewerToken(country: string | undefined): Promise<string> {
  const ip = `198.51.100.${(ipSeq++ % 250) + 1}`;
  addresses.push(ip);
  const headers: Record<string, string> = { 'x-t2f-edge': EDGE_SECRET };
  if (country !== undefined) headers['x-t2f-client'] = `${ip};${country}`;
  const res = await dispatch(new Request(`${BASE}/api/live/viewer-token`, { headers }));
  expect(res.status).toBe(200);
  expect(res.headers.get('cache-control')).toContain('no-store');
  const body = (await res.json()) as { ok: boolean; value: { token: string; expiresAt: string } };
  return body.value.token;
}

/** One browser tab: an anonymous connection subscribed to `live:viewers`, with or without a viewer token. */
async function tab(token: string | null, onPublication?: (ctx: PublicationContext) => void): Promise<{ client: Centrifuge; sub: Subscription }> {
  const client = centrifugeClient(null);
  clients.push(client);
  client.once('connected', (ctx) => clientIds.push(ctx.client));
  expect(await connectAndWait(client)).toBe('connected');
  const sub = client.newSubscription(CHANNEL, token !== null ? { token } : {});
  if (onPublication) sub.on('publication', onPublication);
  const state = await new Promise<string>((resolve) => {
    sub.once('subscribed', () => resolve('subscribed'));
    sub.once('error', (ctx) => resolve(`error ${ctx.error.code}`));
    sub.once('unsubscribed', (ctx) => resolve(`unsubscribed ${ctx.code}`));
    sub.subscribe();
  });
  expect(state).toBe('subscribed');
  return { client, sub };
}

async function closeAll(): Promise<void> {
  for (const c of clients.splice(0)) c.disconnect();
}

async function setSwitches(patch: Pick<SiteSwitches, 'viewersMap' | 'viewersCount'>): Promise<void> {
  const site = siteOf(deps);
  await site.store.inTransaction(null, async (tx) => {
    const current = await site.store.read(tx);
    await site.store.write(tx, { switches: { ...current.switches, ...patch } });
  });
}

/** Polls `fn` until it returns true or `ms` passes. */
async function until(fn: () => Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return fn();
}

beforeAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  deps = testDeps({ redis, log: capture }, { T2F_EDGE_SECRET: EDGE_SECRET });
  payload = await payloadOf(deps)();
  dispatch = await buildDispatcher(deps);
  await siteOf(deps).resetForTests?.();
}, 120_000);

afterEach(async () => {
  await closeAll();
  // Presence is gone once the connections close: the next case starts from an empty channel.
  const empty = aggregator();
  await until(async () => (await fresh(empty)).people === 0, 10 * SEC);
});

afterAll(async () => {
  await closeAll();
  await siteOf(deps)?.resetForTests?.();
  await liveOf(deps)?.lease.release('live-viewers');
  await redis.deleteByPrefix(RL_PREFIX);
  await redis.close();
});

describeRealtime('live viewers (SPEC-12 S9)', () => {
  it('AC-59: tokens from UA, XX and no client header → only UA is a country; all three are people', { timeout: 60_000 }, async () => {
    for (const country of ['UA', 'XX', undefined]) await tab(await viewerToken(country));
    const summary = await fresh(aggregator(1));
    expect(summary.countries.map((c) => c.iso)).toEqual(['UA']);
    expect(summary.people).toBe(3);
  });

  it('AC-60: 3×PL + 2×DE → [PL] without numbers; ticker events 30–60 s apart', { timeout: 120_000 }, async () => {
    for (const country of ['PL', 'PL', 'PL', 'DE', 'DE']) await tab(await viewerToken(country));
    const agg = aggregator();
    const summary = await fresh(agg);
    expect(summary.countries).toEqual([{ iso: 'PL', name: 'Польща', flagCode: 'pl' }]);

    const events: { at: number; data: unknown }[] = [];
    await tab(null, (ctx) => events.push({ at: Date.now(), data: ctx.data }));
    const live = liveOf(deps);
    const viewersBefore = live.viewers;
    deps.live = { ...live, viewers: { aggregator: agg, token: live.viewers!.token } };
    const ticker = startViewersTicker(deps);
    try {
      expect(await until(async () => events.length >= 2, 65 * SEC)).toBe(true);
    } finally {
      await ticker?.stop();
      deps.live = { ...live, ...(viewersBefore ? { viewers: viewersBefore } : {}) };
    }
    const gap = (events[1]?.at ?? 0) - (events[0]?.at ?? 0);
    expect(gap).toBeGreaterThanOrEqual(29 * SEC);
    expect(gap).toBeLessThanOrEqual(60 * SEC);
    const envelope = events[0]?.data as { type: string; data: ViewerSummary };
    expect(envelope.type).toBe('viewers');
    expect(envelope.data.countries.map((c) => c.iso)).toEqual(['PL']);
  });

  it('AC-61: 3 browsers (one with a second tab) → people 3; one browser closes → 2 within 60 s', { timeout: 120_000 }, async () => {
    const browsers = [];
    for (const country of ['PL', 'DE', 'UA']) browsers.push(await tab(await viewerToken(country)));
    await tab(null); // the second tab of the first browser: subscribes without a token
    const agg = aggregator();
    expect((await fresh(agg)).people).toBe(3);
    browsers[1]?.client.disconnect();
    expect(await until(async () => (await fresh(agg)).people === 2, 60 * SEC)).toBe(true);
  });

  it('AC-62: viewersMap × viewersCount through GET /api/live/viewers', { timeout: 60_000 }, async () => {
    for (const country of ['PL', 'PL', 'PL']) await tab(await viewerToken(country));
    const live = liveOf(deps);
    const viewersBefore = live.viewers;
    const agg = aggregator();
    deps.live = { ...live, viewers: { aggregator: agg, token: live.viewers!.token } };
    try {
      for (const [viewersMap, viewersCount] of [[true, true], [true, false], [false, true], [false, false]] as const) {
        await setSwitches({ viewersMap, viewersCount });
        skew += VIEWERS_PASS_MS;
        const res = await dispatch(
          new Request(`${BASE}/api/live/viewers`, { headers: { 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': '198.51.100.251;PL' } }),
        );
        const label = `viewersMap=${viewersMap} viewersCount=${viewersCount}`;
        expect(res.status, label).toBe(200);
        expect(res.headers.get('cache-control'), label).toContain('no-store');
        const { value } = (await res.json()) as { value: ViewerSummary };
        expect(value.countries.map((c) => c.iso), label).toEqual(viewersMap ? ['PL'] : []);
        if (viewersCount) expect(value.people, label).toBe(3);
        else expect('people' in value, label).toBe(false);
      }
    } finally {
      deps.live = { ...live, ...(viewersBefore ? { viewers: viewersBefore } : {}) };
      await setSwitches({ viewersMap: true, viewersCount: true });
    }
  });

  it('AC-63: after 100 subscriptions no address or client id is stored or logged; a new aggregator starts from zero', { timeout: 180_000 }, async () => {
    addresses.length = 0;
    clientIds.length = 0;
    logLines.length = 0;
    const countries = ['PL', 'DE', 'UA', 'XX'];
    for (let i = 0; i < 100; i++) await tab(await viewerToken(countries[i % countries.length]));
    const agg = aggregator();
    expect((await fresh(agg)).people).toBe(100);
    expect(clientIds).toHaveLength(100);

    const needles = [...addresses, ...clientIds];
    const pool = (payload.db as unknown as { pool: { query(sql: string, args?: unknown[]): Promise<{ rows: Record<string, unknown>[] }> } }).pool;
    const tables = (await pool.query(`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`)).rows.map(
      (r) => String(r.table_name),
    );
    expect(tables.length).toBeGreaterThan(0);
    const patterns = needles.map((n) => `%${n}%`);
    const hits: string[] = [];
    for (const table of tables) {
      const { rows } = await pool.query(`SELECT count(*)::int AS n FROM "${table}" t WHERE t::text LIKE ANY($1)`, [patterns]);
      if (Number(rows[0]?.n) > 0) hits.push(table);
    }
    expect(hits).toEqual([]);
    const log = logLines.join('\n');
    expect(needles.filter((n) => log.includes(n))).toEqual([]);

    await closeAll();
    const restarted = aggregator();
    expect(await until(async () => (await fresh(restarted)).people === 0, 10 * SEC)).toBe(true);
    expect((await fresh(restarted)).countries).toEqual([]);
  });
});
