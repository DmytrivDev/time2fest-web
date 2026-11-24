/**
 * After-commit fan-out of the `site` snapshot (SPEC-08 AC-4 … AC-7, AC-33 … AC-37) against the `_test`
 * database, the shared Centrifugo and the R2 emulator of the worktree stack. The first run of the S·P3 SQL
 * (`adapters/payloadSiteState.ts`): lock, row creation, `version + 1`, and the fan-out claim.
 *
 * Changes go through the real services with the site version bump wired the way the composition root will
 * wire it (S·P5): `toggle`, `chooseProduct` (fake products port), `saveCorrection`, `recordCatalogChange`.
 * The fan-out runs on a delivery loop of its own over the real `siteFanOutDepsOf` deps; publish, purge and
 * copy are observed through recorders, a fake purge API on port 0 and the R2 emulator. Retry schedules run
 * on a fake sleep, never real 30 s waits. Tokens are random per run and never appear in a captured line.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { RealtimeEnvelope, SiteState } from '@time2fest/contracts';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import { createLocalReq, type Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createCfPurge, SITE_CACHE_TAG } from '../../src/adapters/cfPurge';
import { createPayloadJournal } from '../../src/adapters/payloadJournal';
import { createPayloadSeasonStore } from '../../src/adapters/payloadCatalog';
import { createFakeProducts } from '../../src/adapters/products';
import { createPayloadSiteStore } from '../../src/adapters/payloadSiteState';
import type { ObjectStore } from '../../src/catalog/ports';
import { recordCatalogChange } from '../../src/catalog/service';
import { catalogCopyDepsOf, eventsOf, payloadOf, siteFanOutDepsOf, startBackground } from '../../src/container';
import { saveCorrection } from '../../src/corrections/service';
import { publisherOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import type { AlarmInput } from '../../src/ports';
import type { ChannelPublisher } from '../../src/realtime/ports';
import {
  COPY_SCHEDULE,
  createSiteFanOutSubscribers,
  PUBLISH_FAILED,
  PURGE_FAILED,
  PURGE_SCHEDULE,
  PURGE_SKIPPED,
  R2_COPY_FAILED,
  settleFanOuts,
  type FanOutDeps,
} from '../../src/site/fanout';
import type { SiteStore } from '../../src/site/ports';
import { chooseProduct, SITE_CHANGED_TOPIC, toggle, type SiteDeps } from '../../src/site/service';
import { readSnapshot } from '../../src/site/snapshot';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';
import { note, percentile } from './measure';
import { deleteUnder, r2Env, readObject, type R2Env } from './r2-helpers';
import { centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const run = `sf${Date.now()}`;
const OWNER = { kind: 'owner' as const, id: 'site-fanout', label: 'site-fanout@test' };
const SYSTEM = { kind: 'system' as const, id: 'site-fanout', label: 'site-fanout' };
const ZONE = randomBytes(16).toString('hex');
const PURGE_TOKEN = `purge-${randomBytes(18).toString('hex')}`; // check-secrets: allow random per-run fake token

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

/** `log-alarms` rows of `code` for `version` (AC-29), polled until at least one appears or `ms` passes. */
async function logAlarmRows(code: string, version: number, ms = 5_000): Promise<{ id: string | number }[]> {
  const end = Date.now() + ms;
  for (;;) {
    const docs = (await payload.find({ collection: 'log-alarms', where: { code: { equals: code } }, overrideAccess: true, depth: 0, limit: 200 })).docs as unknown as {
      id: string | number;
      details?: { version?: number } | null;
    }[];
    const mine = docs.filter((d) => d.details?.version === version);
    if (mine.length > 0 || Date.now() > end) return mine;
    await new Promise((r) => setTimeout(r, 100));
  }
}

/** Records every publish, then forwards it to `inner` (the real Centrifugo publisher, or a closed one). */
function recording(inner: ChannelPublisher | undefined): ChannelPublisher {
  return {
    async publish(classKey, key, envelope) {
      const result = inner ? await inner.publish(classKey, key, envelope) : ({ status: 'ok' } as const);
      if (result.status === 'ok') published.push({ version: envelope.version ?? 0, at: performance.now(), envelope });
      return result;
    },
  };
}

/** A fake Cloudflare purge API on port 0. */
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

/** A port nothing listens on: bound, then released. */
async function closedPort(): Promise<number> {
  const server = http.createServer();
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

let deps: Deps;
let payload: Payload;
let tiny: TinyCatalog;
let store: SiteStore;
let site: SiteDeps;
let core: FanOutDeps;
/** The deps the fan-out rows resolve to; each test sets the part it observes. */
let fan: FanOutDeps;
let bus: EventBus;
let purge: PurgeFake;
let r2: R2Env;

function fanWith(over: Partial<FanOutDeps> = {}): FanOutDeps {
  return { ...core, ...over };
}

/** Flips `chat`; the version after the commit and the time the call returned. */
async function flipChat(): Promise<{ version: number; committedAt: number }> {
  const record = await store.read();
  const result = await toggle(site, null, OWNER, { key: 'chat', value: !record.switches.chat, reason: `fan-out ${run}` }, 'manual');
  const committedAt = performance.now();
  if (!result.ok || !result.changed) throw new Error(`toggle refused: ${JSON.stringify(result)}`);
  return { version: result.version, committedAt };
}

const fannedOut = (version: number) => until(() => published.some((p) => p.version === version), 5_000, `the fan-out of version ${version}`);

beforeAll(async () => {
  deps = testDeps({ log: capture });
  payload = await payloadOf(deps)();
  tiny = await createTinyCatalog(payload, run);
  store = createPayloadSiteStore({ payload: payloadOf(deps), clock: deps.clock });
  site = {
    store,
    products: createFakeProducts([{ id: `pass-${run}`, key: 'pass', price: { amount: 500, currency: 'USD' } }]),
    journal: createPayloadJournal(() => true),
    publisher: eventsOf(deps).publisher,
    clock: deps.clock,
  };
  const real = siteFanOutDepsOf(deps);
  // No purge and no copy unless a test sets them; the real readers, claim and publisher.
  core = {
    snapshot: real.snapshot,
    claim: real.claim,
    publisher: recording(real.publisher),
    alarm: { raise: (a) => void alarms.push(a) },
    log: capture,
    sleep: async (ms) => void sleeps.push(ms),
  };
  fan = fanWith();
  purge = await purgeFake();
  r2 = r2Env();
  await deleteUnder(r2, `${r2.prefix}site/`);
  bus = await startBackground(deps, createSiteFanOutSubscribers(async () => fan));
});

afterAll(async () => {
  await bus?.stop();
  await settleFanOuts();
  await purge?.close();
  if (r2) await deleteUnder(r2, `${r2.prefix}site/`);
  if (payload) await removeTinyCatalog(payload, run);
});

describe('site fan-out after commit', { timeout: 60_000 }, () => {
  it('AC-4: every change kind (toggle, product, correction, catalog) commits a higher version, and each is fanned out', async () => {
    fan = fanWith();
    const seen: number[] = [(await store.read()).version];

    seen.push((await flipChat()).version);

    const chosen = await chooseProduct(site, null, OWNER, { key: 'pass', productId: `pass-${run}`, reason: `fan-out ${run}` });
    if (!chosen.ok) throw new Error(`product refused: ${JSON.stringify(chosen)}`);
    seen.push(chosen.version);

    const corrections = deps.corrections;
    if (!corrections) throw new Error('no corrections in deps');
    const saved = await saveCorrection(
      { ...corrections, siteVersion: store },
      await createLocalReq({ context: { t2fTrusted: true } }, payload),
      { changes: { [tiny.keys.event]: { hidden: true } }, expectedVersions: { [tiny.keys.event]: 0 }, confirmWarnings: true },
      SYSTEM,
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    seen.push((await store.read()).version);

    const catalog = await store.inTransaction(null, (tx) =>
      recordCatalogChange({ seasons: createPayloadSeasonStore(), publisher: eventsOf(deps).publisher, clock: deps.clock, siteVersion: store }, tx),
    );
    expect(catalog).not.toBeNull();
    seen.push((await store.read()).version);

    for (let i = 1; i < seen.length; i += 1) expect(seen[i], `change ${i}`).toBeGreaterThan(seen[i - 1] as number);
    // The correction and the catalog change reach the fan-out through their own topics.
    await fannedOut(seen.at(-1) as number);
    const snapshot = await readSnapshot(core.snapshot);
    expect(snapshot.ok && snapshot.state.eventPatches[tiny.keys.event]).toMatchObject({ hidden: true });
    expect(snapshot.ok && snapshot.state.products).toEqual([{ key: 'pass', price: { amount: 500, currency: 'USD' }, priceVersion: expect.any(Number) }]);
    await settleFanOuts();
  });

  it('AC-4: two concurrent toggles commit two distinct, increasing versions', async () => {
    fan = fanWith();
    const record = await store.read();
    const [a, b] = await Promise.all([
      toggle(site, null, OWNER, { key: 'toasts', value: !record.switches.toasts, reason: 'concurrent a' }, 'manual'),
      toggle(site, null, OWNER, { key: 'viewersMap', value: !record.switches.viewersMap, reason: 'concurrent b' }, 'manual'),
    ]);
    if (!a?.ok || !b?.ok) throw new Error('toggle refused');
    expect(a.version).not.toBe(b.version);
    expect(Math.min(a.version, b.version)).toBeGreaterThan(record.version);
    expect(Math.max(a.version, b.version)).toBe((await store.read()).version);
    await fannedOut(Math.max(a.version, b.version));
    await settleFanOuts();
  });

  it('AC-5: the published event is the snapshot envelope of the committed version', async () => {
    fan = fanWith();
    const { version } = await flipChat();
    await fannedOut(version);
    await settleFanOuts();
    const event = published.find((p) => p.version === version);
    const snapshot = await readSnapshot(core.snapshot);
    if (!snapshot.ok) throw new Error('snapshot unavailable');
    expect(event?.envelope).toEqual({ type: 'snapshot', id: `site:${version}`, version, data: snapshot.state });
    // One event per version: no other fan-out of this version.
    expect(published.filter((p) => p.version === version)).toHaveLength(1);
  });

  it('AC-6: a rolled-back change publishes nothing, purges nothing and writes no R2 copy', async () => {
    const puts: string[] = [];
    fan = fanWith({
      purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base }), siteUrl: 'https://t2f.test' },
      copy: { objects: { put: async (key) => void puts.push(key) }, prefix: r2.prefix },
    });
    purge.mode = 'ok';
    const before = await store.read();
    const counts = { published: published.length, purges: purge.requests.length };
    await expect(
      store.inTransaction(null, async (tx) => {
        await store.write(tx, { switches: { ...before.switches, chat: !before.switches.chat } });
        await eventsOf(deps).publisher.publish(tx, SITE_CHANGED_TOPIC, { version: before.version + 1 });
        throw new Error('forced rollback');
      }),
    ).rejects.toThrow('forced rollback');
    // Delivery of a committed event takes ≤ 2 s (SPEC-06 AC-40): wait past it.
    await wait(2_500);
    await settleFanOuts();
    expect((await store.read()).version).toBe(before.version);
    expect(published.length).toBe(counts.published);
    expect(purge.requests.length).toBe(counts.purges);
    expect(puts).toEqual([]);
  });

  it('AC-7: Centrifugo unreachable → the change stays, a read returns the new version, exactly one site/publish-failed', async () => {
    const closed = testDeps({ log: capture }, { T2F_CENTRIFUGO_URL: `http://127.0.0.1:${await closedPort()}`, T2F_CENTRIFUGO_API_KEY: randomBytes(24).toString('hex') });
    fan = fanWith({ publisher: publisherOf(closed), alarm: { raise: (a) => (alarms.push(a), deps.alarm.raise(a)) } });
    const { version } = await flipChat();
    await until(() => linesOf(PUBLISH_FAILED, version).length > 0, 10_000, 'site/publish-failed');
    await settleFanOuts();
    expect(linesOf(PUBLISH_FAILED, version)).toHaveLength(1);
    expect(linesOf(PUBLISH_FAILED, version)[0]?.level).toBe('warn');
    // AC-29: the same failure is also ONE `log` alarm → one `log-alarms` row of the version.
    const raisedPublish = alarms.filter((a) => a.code === PUBLISH_FAILED && a.details?.version === version);
    expect(raisedPublish).toHaveLength(1);
    expect(raisedPublish[0]?.level).toBe('log');
    const rows = await logAlarmRows(PUBLISH_FAILED, version);
    expect(rows).toHaveLength(1);
    for (const r of rows) await payload.delete({ collection: 'log-alarms', id: r.id, overrideAccess: true });
    const snapshot = await readSnapshot(core.snapshot);
    expect(snapshot.ok && snapshot.state.version).toBe(version);
  });

  it('AC-33: with purge settings, ONE tag purge request after the commit, within 2 s', async () => {
    fan = fanWith({ purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base }), siteUrl: 'https://t2f.test' } });
    purge.mode = 'ok';
    const from = purge.requests.length;
    const { version, committedAt } = await flipChat();
    await until(() => purge.requests.length > from, 5_000, 'the purge request');
    await settleFanOuts();
    const mine = purge.requests.slice(from);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ method: 'POST', url: `/client/v4/zones/${ZONE}/purge_cache`, auth: `Bearer ${PURGE_TOKEN}`, body: { tags: [SITE_CACHE_TAG] } });
    expect((mine[0]?.at ?? 0) - committedAt).toBeGreaterThanOrEqual(0);
    expect((mine[0]?.at ?? 0) - committedAt).toBeLessThanOrEqual(2_000);
    expect(SITE_CACHE_TAG).toBe('t2f-site-state');
    expect(linesOf(PURGE_SKIPPED, version)).toEqual([]);
  });

  it('AC-34: without purge settings, one site/purge-skipped per change and no request', async () => {
    fan = fanWith();
    const from = purge.requests.length;
    const one = await flipChat();
    await fannedOut(one.version);
    const two = await flipChat();
    await fannedOut(two.version);
    await settleFanOuts();
    expect(linesOf(PURGE_SKIPPED, one.version)).toHaveLength(1);
    expect(linesOf(PURGE_SKIPPED, two.version)).toHaveLength(1);
    expect(purge.requests.length).toBe(from);
  });

  it('AC-35: an always-failing purge API → attempts at 0, 30, 120 s, then ONE log alarm site/purge-failed', async () => {
    fan = fanWith({ purge: { sink: createCfPurge({ zoneId: ZONE, token: PURGE_TOKEN, baseUrl: purge.base }), siteUrl: 'https://t2f.test' } });
    purge.mode = 'fail';
    const from = purge.requests.length;
    sleeps.length = 0;
    const { version } = await flipChat();
    await fannedOut(version);
    await settleFanOuts();
    purge.mode = 'ok';
    expect(purge.requests.length - from).toBe(3);
    expect(sleeps).toEqual([PURGE_SCHEDULE[1], (PURGE_SCHEDULE[2] as number) - (PURGE_SCHEDULE[1] as number)]);
    const raised = alarms.filter((a) => a.code === PURGE_FAILED && a.details?.version === version);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.level).toBe('log');
  });

  it('AC-36: the R2 copy site/latest.json equals the published snapshot', async () => {
    const copyDeps = catalogCopyDepsOf(deps);
    if (!copyDeps) throw new Error('r2: not configured');
    fan = fanWith({ copy: { objects: copyDeps.objects, prefix: copyDeps.prefix } });
    const { version } = await flipChat();
    await fannedOut(version);
    await settleFanOuts();
    const event = published.find((p) => p.version === version);
    const body = JSON.parse(await readObject(r2, `${r2.prefix}site/latest.json`)) as SiteState;
    expect(body).toEqual(event?.envelope.data);
    expect(body.version).toBe(version);
  });

  it('AC-36: an always-failing bucket → 4 attempts at 0, 30, 120, 300 s, then ONE page alarm site/r2-copy-failed', async () => {
    let attempts = 0;
    const failing: ObjectStore = {
      put: async () => {
        attempts += 1;
        throw new Error('bucket down');
      },
    };
    fan = fanWith({ copy: { objects: failing, prefix: r2.prefix } });
    sleeps.length = 0;
    const { version } = await flipChat();
    await fannedOut(version);
    await settleFanOuts();
    expect(attempts).toBe(4);
    expect(sleeps).toEqual(COPY_SCHEDULE.slice(1).map((offset, i) => offset - (COPY_SCHEDULE[i] as number)));
    const raised = alarms.filter((a) => a.code === R2_COPY_FAILED && a.details?.version === version);
    expect(raised).toHaveLength(1);
    expect(raised[0]?.level).toBe('page');
  });

  it('no captured line or alarm carries the purge token', () => {
    expect(JSON.stringify(lines)).not.toContain(PURGE_TOKEN);
    expect(JSON.stringify(alarms)).not.toContain(PURGE_TOKEN);
  });
});

describeRealtime('site fan-out to Centrifugo', () => {
  let client: Centrifuge;
  const got: { at: number; data: RealtimeEnvelope }[] = [];

  beforeAll(async () => {
    // `core.publisher` records and forwards to the real Centrifugo publisher of `deps`.
    fan = fanWith();
    client = centrifugeClient(null);
    expect(await connectAndWait(client)).toBe('connected');
    const sub = client.newSubscription(name('site:state'));
    sub.on('publication', (ctx: PublicationContext) => got.push({ at: performance.now(), data: ctx.data as RealtimeEnvelope }));
    const subscribed = new Promise<void>((resolve) => sub.once('subscribed', () => resolve()));
    sub.subscribe();
    await subscribed;
  });

  afterAll(() => client?.disconnect());

  it('AC-5: an anonymous site:state subscriber receives the snapshot ≤ 1 s after the change returns (p95 over 20)', { timeout: 120_000 }, async () => {
    const delays: number[] = [];
    for (let i = 0; i < 20; i += 1) {
      const { version, committedAt } = await flipChat();
      await until(() => got.some((g) => g.data.version === version), 5_000, `publication of version ${version}`);
      const arrival = got.find((g) => g.data.version === version);
      expect(arrival?.data).toMatchObject({ type: 'snapshot', id: `site:${version}`, version });
      delays.push((arrival?.at ?? 0) - committedAt);
    }
    await settleFanOuts();
    const sorted = [...delays].sort((a, b) => a - b);
    const p95 = percentile(sorted, 0.95);
    note(`T2F_MEASURE ${JSON.stringify({ metric: 'site-snapshot-publish-ms', n: sorted.length, p50: percentile(sorted, 0.5), p95, max: sorted.at(-1) })}`);
    expect(p95).toBeLessThanOrEqual(1_000);
  });
});
