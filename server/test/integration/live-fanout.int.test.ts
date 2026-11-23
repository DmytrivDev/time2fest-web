/**
 * After-commit fan-out of the live chains (SPEC-12 AC-5, AC-6, AC-7, AC-14, AC-15; AC-74 for the R2 copy) against the
 * `_test` database, the shared Centrifugo and the R2 emulator of the worktree stack. No YouTube at all: a change is
 * committed the way the poller commits one (checks, version bump and `live.changed` in one transaction).
 *
 * The fan-out runs on a delivery loop of its own over the real `liveFanOutDepsOf` deps, with the events of this run
 * given by a stub (one event of its own); publish, purge and copy are observed through recorders, a fake purge API on
 * port 0 and the R2 emulator. Retry schedules run on a fake sleep. Tokens are random per run and never logged.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { ChainsResponse, RealtimeEnvelope, StreamEvent } from '@time2fest/contracts';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCfPurge } from '../../src/adapters/cfPurge';
import type { ObjectStore } from '../../src/catalog/ports';
import { catalogCopyDepsOf, eventsOf, liveFanOutDepsOf, payloadOf, startBackground } from '../../src/container';
import { EVENT_PATCH_CHANGED_TOPIC } from '../../src/corrections/service';
import type { LiveEvent } from '../../src/domain/live/moment';
import { liveOf, publisherOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import {
  COPY_SCHEDULE,
  createLiveFanOutSubscribers,
  LIVE_CACHE_TAG,
  PUBLISH_FAILED,
  PURGE_FAILED,
  PURGE_SCHEDULE,
  PURGE_SKIPPED,
  R2_COPY_FAILED,
  settleLiveFanOuts,
  type LiveFanOutDeps,
} from '../../src/live/fanout';
import { LIVE_CHANGED_TOPIC, type LiveChangedPayload } from '../../src/live/poller';
import type { SourceCheck } from '../../src/live/ports';
import { readChains } from '../../src/live/snapshot';
import type { AlarmInput } from '../../src/ports';
import type { ChannelPublisher } from '../../src/realtime/ports';
import { testDeps } from './helpers';
import { note, percentile } from './measure';
import { deleteUnder, r2Env, readObject, type R2Env } from './r2-helpers';
import { centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const run = `lf${Date.now()}`;
const ZONE = randomBytes(16).toString('hex');
const PURGE_TOKEN = `purge-${randomBytes(18).toString('hex')}`; // check-secrets: allow random per-run fake token
const EVENT: LiveEvent = { eventId: `evt_${run}`, zoneId: 'Europe/London', moment: Date.parse('2027-01-01T00:00:00Z'), nonMidnight: false, hidden: false };
const SOURCE = `src_${run}_1`;
const SECOND = `src_${run}_2`;
/** Stored YouTube fields; `embeddable` is left out — on the wire it is our own constant `true` of a served source. */
const YOUTUBE_FIELDS = ['liveBroadcastContent', 'privacyStatus', 'scheduledStartTime', 'actualStartTime', 'actualEndTime', 'ytFetchedAt'];

type Line = { level: string; fields: Record<string, unknown> };
const lines: Line[] = [];
const capture = {
  info: (fields: Record<string, unknown>) => void lines.push({ level: 'info', fields }),
  warn: (fields: Record<string, unknown>) => void lines.push({ level: 'warn', fields }),
  error: (fields: Record<string, unknown>) => void lines.push({ level: 'error', fields }),
};
const alarms: AlarmInput[] = [];
const sleeps: number[] = [];
const published: { version: number; at: number; envelope: RealtimeEnvelope }[] = [];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => boolean, ms: number, what: string): Promise<void> {
  const end = performance.now() + ms;
  while (!pred()) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(20);
  }
}
const linesOf = (event: string, version: number) => lines.filter((l) => l.fields.event === event && l.fields.version === version);
const ofVersion = (version: number) => published.filter((p) => p.version === version);

/** Records every accepted publish, then forwards it to `inner` (the real Centrifugo publisher, or a closed one). */
function recording(inner: ChannelPublisher | undefined): ChannelPublisher {
  return {
    async publish(classKey, key, envelope) {
      const result = inner ? await inner.publish(classKey, key, envelope) : ({ status: 'ok' } as const);
      if (result.status === 'ok') published.push({ version: envelope.version ?? 0, at: performance.now(), envelope });
      return result;
    },
  };
}

interface PurgeFake {
  base: string;
  requests: { method: string; url: string; auth: string; body: unknown; at: number }[];
  mode: 'ok' | 'fail';
  close(): Promise<void>;
}
async function purgeFake(): Promise<PurgeFake> {
  const fake: Omit<PurgeFake, 'base' | 'close'> = { requests: [], mode: 'ok' };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      fake.requests.push({ method: req.method ?? '', url: req.url ?? '', auth: String(req.headers.authorization ?? ''), body: JSON.parse(raw || 'null'), at: performance.now() });
      const ok = fake.mode === 'ok';
      res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ success: ok, errors: [], messages: [] }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    base: `http://127.0.0.1:${port}/client/v4`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let deps: Deps;
let payload: Payload;
let live: LiveWiring;
let core: LiveFanOutDeps;
let fan: LiveFanOutDeps;
let bus: EventBus;
let purge: PurgeFake;
let r2: R2Env;
/** The events of this run: one, whose `hidden` a test flips (the correction's effect). */
const event: LiveEvent = { ...EVENT };
let flip = 0;

function fanWith(over: Partial<LiveFanOutDeps> = {}): LiveFanOutDeps {
  return { ...core, ...over };
}

/** A fresh, servable check of a source; the status alternates so every commit changes the public chain. */
function goodCheck(sourceId: string, status: 'live' | 'expected'): SourceCheck {
  const now = deps.clock.now();
  return {
    sourceId,
    youtube: {
      fields: { liveBroadcastContent: status === 'live' ? 'live' : 'upcoming', privacyStatus: 'public', embeddable: true, scheduledStartTime: null, actualStartTime: null, actualEndTime: null },
      fetchedAt: now,
    },
    verdict: { status, startsAt: status === 'expected' ? EVENT.moment : null, dead: false, deadReason: null },
    lastChecked: now,
  };
}

/** Commits a change the way the poller does: checks, `version + 1` and one `live.changed`, in one transaction. */
async function commitChange(
  opts: { checks?: SourceCheck[]; hidden?: LiveChangedPayload['hidden']; rollback?: boolean } = {},
): Promise<{ version: number; committedAt: number }> {
  flip += 1;
  const checks = opts.checks ?? [goodCheck(SOURCE, flip % 2 ? 'live' : 'expected')];
  const version = await live.store.inTransaction(null, async (tx) => {
    await live.store.state(tx);
    await live.store.applyChecks(tx, checks);
    const v = await live.store.bumpVersion(tx);
    const body: LiveChangedPayload = { version: v, eventIds: [EVENT.eventId], ...(opts.hidden ? { hidden: opts.hidden } : {}) };
    await eventsOf(deps).publisher.publish(tx, LIVE_CHANGED_TOPIC, body);
    if (opts.rollback) throw new Error('forced rollback');
    return v;
  });
  return { version, committedAt: performance.now() };
}

const fannedOut = (version: number) => until(() => ofVersion(version).length > 0, 5_000, `the fan-out of version ${version}`);
const body = () => readChains(core.chains, deps.clock.now());

async function removeSources(): Promise<void> {
  await payload.delete({ collection: 'stream-sources', where: { eventId: { equals: EVENT.eventId } }, overrideAccess: true });
}

beforeAll(async () => {
  deps = testDeps({ log: capture });
  payload = await payloadOf(deps)();
  live = liveOf(deps);
  await removeSources();
  for (const [sourceId, order] of [
    [SOURCE, 0],
    [SECOND, 1],
  ] as const) {
    await payload.create({
      collection: 'stream-sources',
      data: { sourceId, eventId: EVENT.eventId, platform: 'youtube', videoId: `v${run.slice(-9)}${order}`, order, status: 'live' } as never,
      overrideAccess: true,
    });
  }
  const real = liveFanOutDepsOf(deps);
  core = {
    ...real,
    chains: { ...real.chains, events: { events: async () => [{ ...event }] } },
    publisher: recording(real.publisher),
    alarm: { raise: (a) => void alarms.push(a) },
    log: capture,
    sleep: async (ms) => void sleeps.push(ms),
  };
  delete core.purge;
  delete core.copy;
  fan = fanWith();
  // Both sources servable before the first test.
  await commitChange({ checks: [goodCheck(SOURCE, 'live'), goodCheck(SECOND, 'live')] });
  purge = await purgeFake();
  r2 = r2Env();
  await deleteUnder(r2, `${r2.prefix}live/`);
  bus = await startBackground(deps, createLiveFanOutSubscribers(async () => fan));
});

afterAll(async () => {
  await bus?.stop();
  await settleLiveFanOuts();
  await purge?.close();
  if (r2) await deleteUnder(r2, `${r2.prefix}live/`);
  if (payload) await removeSources();
});

describe('live fan-out after commit', { timeout: 60_000 }, () => {
  it('AC-5: a committed change publishes ONE `chain` event of its version on live:streams, with the chains of the route', async () => {
    fan = fanWith();
    const { version } = await commitChange();
    await fannedOut(version);
    await settleLiveFanOuts();
    const mine = ofVersion(version);
    expect(mine).toHaveLength(1);
    const current = await body();
    const chain = current.chains.find((c) => c.eventId === EVENT.eventId);
    expect(chain?.sources.map((s) => s.id)).toEqual([SOURCE, SECOND]);
    if (!chain) throw new Error('no chain for the event');
    expect(mine[0]?.envelope).toEqual({ type: 'chain', id: `live:${version}:0`, version, data: { type: 'chain', chain: { ...chain, version }, version } satisfies StreamEvent });
  });

  it('AC-5: two concurrent changes commit two distinct, increasing versions, each fanned out once', async () => {
    fan = fanWith();
    const before = (await live.store.state()).version;
    const [a, b] = await Promise.all([commitChange(), commitChange({ checks: [goodCheck(SECOND, 'live')] })]);
    expect(a.version).not.toBe(b.version);
    expect(Math.min(a.version, b.version)).toBeGreaterThan(before);
    await fannedOut(a.version);
    await fannedOut(b.version);
    await settleLiveFanOuts();
    expect(ofVersion(a.version)).toHaveLength(1);
    expect(ofVersion(b.version)).toHaveLength(1);
  });

  it('AC-6: a rolled-back change publishes nothing, purges nothing and writes no R2 copy', async () => {
    const puts: string[] = [];
    fan = fanWith({
      purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base, tag: LIVE_CACHE_TAG }), siteUrl: 'https://t2f.test' },
      copy: { objects: { put: async (key) => void puts.push(key) }, prefix: r2.prefix },
    });
    purge.mode = 'ok';
    const before = (await live.store.state()).version;
    const counts = { published: published.length, purges: purge.requests.length };
    await expect(commitChange({ rollback: true })).rejects.toThrow('forced rollback');
    // Delivery of a committed event takes ≤ 2 s (SPEC-06 AC-40): wait past it.
    await wait(2_500);
    await settleLiveFanOuts();
    expect((await live.store.state()).version).toBe(before);
    expect(published.length).toBe(counts.published);
    expect(purge.requests.length).toBe(counts.purges);
    expect(puts).toEqual([]);
  });

  it('AC-7: Centrifugo unreachable → the change stays, the chains read returns the new version, exactly one live/publish-failed', async () => {
    const closed = testDeps({ log: capture }, { T2F_CENTRIFUGO_URL: `http://127.0.0.1:${await closedPort()}`, T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex') });
    fan = fanWith({ publisher: publisherOf(closed) });
    // Two chain events and one hide: still one line for the version.
    const { version } = await commitChange({ hidden: [{ eventId: EVENT.eventId, sourceId: `${SOURCE}-gone` }] });
    await until(() => linesOf(PUBLISH_FAILED, version).length > 0, 10_000, 'live/publish-failed');
    await settleLiveFanOuts();
    expect(linesOf(PUBLISH_FAILED, version)).toHaveLength(1);
    expect(linesOf(PUBLISH_FAILED, version)[0]?.level).toBe('warn');
    expect((await body()).version).toBe(version);
  });

  it('AC-5: a hidden source → one `hide` event with the version, after the chain', async () => {
    fan = fanWith();
    const { version } = await commitChange({ hidden: [{ eventId: EVENT.eventId, sourceId: SECOND }] });
    await until(() => ofVersion(version).length >= 2, 5_000, 'the hide event');
    await settleLiveFanOuts();
    const mine = ofVersion(version).map((p) => p.envelope);
    expect(mine.map((e) => e.type)).toEqual(['chain', 'hide']);
    expect(mine[1]).toEqual({ type: 'hide', id: `live:${version}:1`, version, data: { type: 'hide', eventId: EVENT.eventId, sourceId: SECOND, version } });
  });

  it('AC-10: a correction of the event (event-patch.changed) moves the version and publishes its chain — empty while hidden', async () => {
    fan = fanWith();
    const before = (await live.store.state()).version;
    event.hidden = true;
    try {
      await live.store.inTransaction(null, (tx) => eventsOf(deps).publisher.publish(tx, EVENT_PATCH_CHANGED_TOPIC, { eventId: EVENT.eventId, before: null, after: { hidden: true }, version: 1 }));
      await until(() => published.some((p) => p.version > before && p.envelope.type === 'chain'), 5_000, 'the chain of the corrected event');
      await settleLiveFanOuts();
      const got = published.find((p) => p.version > before && p.envelope.type === 'chain');
      expect(got?.envelope.data).toEqual({ type: 'chain', chain: { eventId: EVENT.eventId, sources: [], version: got?.version }, version: got?.version });
      const current = await body();
      expect(current.version).toBeGreaterThan(before);
      expect(current.chains.find((c) => c.eventId === EVENT.eventId)).toBeUndefined();
    } finally {
      event.hidden = false;
    }
  });

  it('AC-14: with purge settings, ONE request with the tag t2f-live-chains after the commit, within 2 s', async () => {
    fan = fanWith({ purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base, tag: LIVE_CACHE_TAG }), siteUrl: 'https://t2f.test' } });
    purge.mode = 'ok';
    const from = purge.requests.length;
    const { version, committedAt } = await commitChange();
    await until(() => purge.requests.length > from, 5_000, 'the purge request');
    await settleLiveFanOuts();
    const mine = purge.requests.slice(from);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ method: 'POST', url: `/client/v4/zones/${ZONE}/purge_cache`, auth: `Bearer ${PURGE_TOKEN}`, body: { tags: ['t2f-live-chains'] } });
    expect((mine[0]?.at ?? 0) - committedAt).toBeLessThanOrEqual(2_000);
    expect(linesOf(PURGE_SKIPPED, version)).toEqual([]);
  });

  it('AC-14: without purge settings, one live/purge-skipped per change and no request', async () => {
    fan = fanWith();
    const from = purge.requests.length;
    const one = await commitChange();
    await fannedOut(one.version);
    const two = await commitChange();
    await fannedOut(two.version);
    await settleLiveFanOuts();
    expect(linesOf(PURGE_SKIPPED, one.version)).toHaveLength(1);
    expect(linesOf(PURGE_SKIPPED, two.version)).toHaveLength(1);
    expect(linesOf(PURGE_SKIPPED, one.version)[0]?.level).toBe('info');
    expect(purge.requests.length).toBe(from);
  });

  it('AC-14: an always-failing purge API → attempts at 0, 30, 120 s, then ONE log alarm live/purge-failed', async () => {
    fan = fanWith({ purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base, tag: LIVE_CACHE_TAG }), siteUrl: 'https://t2f.test' } });
    purge.mode = 'fail';
    const from = purge.requests.length;
    sleeps.length = 0;
    const { version } = await commitChange();
    await fannedOut(version);
    await settleLiveFanOuts();
    purge.mode = 'ok';
    expect(purge.requests.length - from).toBe(3);
    expect(sleeps).toEqual([PURGE_SCHEDULE[1], (PURGE_SCHEDULE[2] as number) - (PURGE_SCHEDULE[1] as number)]);
    const raised = alarms.filter((a) => a.code === PURGE_FAILED && a.details?.version === version);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.level).toBe('log');
  });

  it('AC-15: the R2 copy live/chains.json equals the chains body of the route', async () => {
    const copyDeps = catalogCopyDepsOf(deps);
    if (!copyDeps) throw new Error('r2: not configured');
    fan = fanWith({ copy: { objects: copyDeps.objects, prefix: copyDeps.prefix } });
    const { version } = await commitChange();
    await fannedOut(version);
    await settleLiveFanOuts();
    const raw = await readObject(r2, `${r2.prefix}live/chains.json`);
    const copied = JSON.parse(raw) as ChainsResponse;
    expect(copied.version).toBe(version);
    expect(raw).toBe(JSON.stringify(await body()));
  });

  it('AC-15: an always-failing bucket → 4 attempts at 0, 30, 120, 300 s, then ONE page alarm live/r2-copy-failed', async () => {
    let attempts = 0;
    const failing: ObjectStore = {
      put: async () => {
        attempts += 1;
        throw new Error('bucket down');
      },
    };
    fan = fanWith({ copy: { objects: failing, prefix: r2.prefix } });
    sleeps.length = 0;
    const { version } = await commitChange();
    await fannedOut(version);
    await settleLiveFanOuts();
    expect(attempts).toBe(4);
    expect(sleeps).toEqual(COPY_SCHEDULE.slice(1).map((offset, i) => offset - (COPY_SCHEDULE[i] as number)));
    const raised = alarms.filter((a) => a.code === R2_COPY_FAILED && a.details?.version === version);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.level).toBe('page');
  });

  it('AC-74: YouTube fields cleared by retention → the R2 copy has neither the source nor any YouTube field', async () => {
    const copyDeps = catalogCopyDepsOf(deps);
    if (!copyDeps) throw new Error('r2: not configured');
    fan = fanWith({ copy: { objects: copyDeps.objects, prefix: copyDeps.prefix } });
    const { version } = await commitChange({ checks: [{ sourceId: SOURCE, youtube: null }] });
    await fannedOut(version);
    await settleLiveFanOuts();
    const raw = await readObject(r2, `${r2.prefix}live/chains.json`);
    const copied = JSON.parse(raw) as ChainsResponse;
    expect(copied.version).toBe(version);
    expect(copied.chains.find((c) => c.eventId === EVENT.eventId)?.sources.map((s) => s.id)).not.toContain(SOURCE);
    for (const field of YOUTUBE_FIELDS) expect(raw.includes(`"${field}"`), field).toBe(false);
    // Servable again for the tests below.
    await commitChange({ checks: [goodCheck(SOURCE, 'live')] });
    await settleLiveFanOuts();
  });

  it('no captured line or alarm carries the purge token', () => {
    expect(JSON.stringify(lines)).not.toContain(PURGE_TOKEN);
    expect(JSON.stringify(alarms)).not.toContain(PURGE_TOKEN);
  });
});

describeRealtime('live fan-out to Centrifugo', () => {
  let client: Centrifuge;
  const got: { at: number; data: RealtimeEnvelope }[] = [];

  beforeAll(async () => {
    fan = fanWith();
    client = centrifugeClient(null);
    expect(await connectAndWait(client)).toBe('connected');
    const sub = client.newSubscription(name('live:streams'));
    sub.on('publication', (ctx: PublicationContext) => got.push({ at: performance.now(), data: ctx.data as RealtimeEnvelope }));
    const subscribed = new Promise<void>((resolve) => sub.once('subscribed', () => resolve()));
    sub.subscribe();
    await subscribed;
  });

  afterAll(() => client?.disconnect());

  it('AC-5: an anonymous live:streams subscriber receives the new version ≤ 1 s after the commit (p95 over 20)', { timeout: 120_000 }, async () => {
    const delays: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const { version, committedAt } = await commitChange();
      await until(() => got.some((g) => g.data.version === version), 5_000, `publication of version ${version}`);
      const arrival = got.find((g) => g.data.version === version);
      expect(arrival?.data).toMatchObject({ type: 'chain', version, data: { type: 'chain', version } });
      delays.push((arrival?.at ?? 0) - committedAt);
    }
    await settleLiveFanOuts();
    const sorted = [...delays].sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    note(`T2F_MEASURE ${JSON.stringify({ metric: 'live-chain-publish-ms', n: sorted.length, p50: percentile(sorted, 0.5), p95, max: sorted.at(-1) })}`);
    expect(p95).toBeLessThanOrEqual(1_000);
  });
});
