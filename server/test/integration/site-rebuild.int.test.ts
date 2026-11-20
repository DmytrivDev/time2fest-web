/**
 * Catalog rebuild after a catalog change (SPEC-08 AC-61 … AC-66) against the `_test` database: the real outbox,
 * the real delivery loop with the `site-rebuild` row, the real rebuild state on the `site-state` row and the real
 * GitHub dispatch adapter pointed at a fake on port 0 — never api.github.com.
 *
 * Time is a manual clock injected into the deps (the outbox stamps `committedAt` with it, the ticker reads it), so
 * a 150 s debounce or a freeze window costs nothing; the process ticker is emulated by calling one tick per 15 s
 * step of that clock. The shared clock of the test database is not moved (other files may run beside this one).
 * The `catalog.changed` events carry the current catalog's own version and time, so no reader sees a foreign
 * version; the catalog itself is not changed. Retries run on a fake sleep. The token is random per run and
 * never appears in a captured line.
 */
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { CatalogChangedSchema } from '@time2fest/contracts/schemas';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DISPATCH_PATH } from '../../src/adapters/githubDispatch';
import { createPayloadRebuildStore, createPayloadSiteStore } from '../../src/adapters/payloadSiteState';
import { CATALOG_CHANGED_TOPIC } from '../../src/catalog/service';
import { eventsOf, payloadOf, rebuildDepsOf, seedStoreOf, startBackground, startRebuildTicker } from '../../src/container';
import { dueAfter, REBUILD_DEBOUNCE_MS, REBUILD_TICK_MS } from '../../src/domain/site/rebuild';
import type { Deps } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import type { AlarmInput } from '../../src/ports';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import {
  createRebuildSubscriber,
  REBUILD_FAILED,
  REBUILD_FROZEN,
  REBUILD_NOT_CONFIGURED,
  settleRebuilds,
  tickRebuild,
  type RebuildDeps,
  type TickOutcome,
} from '../../src/site/rebuild';
import type { RebuildStore, SiteStore } from '../../src/site/ports';
import { testDeps } from './helpers';

const TOKEN = `ghd-${randomBytes(18).toString('hex')}`; // check-secrets: allow random per-run fake token
const utc = (s: string) => Date.parse(`${s}Z`);

type Line = { level: string; fields: Record<string, unknown> };
const lines: Line[] = [];
const capture = {
  info: (fields: Record<string, unknown>) => void lines.push({ level: 'info', fields }),
  warn: (fields: Record<string, unknown>) => void lines.push({ level: 'warn', fields }),
  error: (fields: Record<string, unknown>) => void lines.push({ level: 'error', fields }),
};
const alarms: AlarmInput[] = [];
const sleeps: number[] = [];
const linesOf = (event: string) => lines.filter((l) => l.fields.event === event);

/** The manual server clock of these deps. */
const clock = { t: utc('2026-12-20T12:00:00'), now: () => clock.t };

/** A fake GitHub API on port 0: records every dispatch, answers 204 (ok) or 500 (fail). */
interface DispatchFake {
  base: string;
  requests: { method: string; url: string; auth: string; accept: string; body: unknown; at: number }[];
  mode: 'ok' | 'fail';
  close(): Promise<void>;
}
async function dispatchFake(): Promise<DispatchFake> {
  const fake: Omit<DispatchFake, 'base' | 'close'> = { requests: [], mode: 'ok' };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString('utf8')));
    req.on('end', () => {
      fake.requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth: String(req.headers.authorization ?? ''),
        accept: String(req.headers.accept ?? ''),
        body: JSON.parse(raw || 'null'),
        at: clock.t,
      });
      if (fake.mode === 'ok') {
        res.writeHead(204);
        res.end();
      } else {
        res.writeHead(500, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ message: 'Server Error' }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return Object.assign(fake, {
    base: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(pred: () => Promise<boolean>, ms: number, what: string): Promise<void> {
  const end = performance.now() + ms;
  while (!(await pred())) {
    if (performance.now() > end) throw new Error(`timed out waiting for ${what}`);
    await wait(25);
  }
}

let deps: Deps;
let site: SiteStore;
let state: RebuildStore;
let fake: DispatchFake;
let bus: EventBus;
let withToken: RebuildDeps;
/** What the `site-rebuild` row resolves to; a test may swap it. */
let current: RebuildDeps;
let catalog: { version: string; at: string };
/** `catalog.changed` events the row has handled. */
let delivered = 0;

/** Commits one `catalog.changed` at virtual time `at` and waits until the row has scheduled it. */
async function change(at: number): Promise<void> {
  clock.t = at;
  const before = delivered;
  await site.inTransaction(null, (tx) => eventsOf(deps).publisher.publish(tx, CATALOG_CHANGED_TOPIC, CatalogChangedSchema.parse(catalog)));
  await until(async () => delivered > before, 5_000, `the schedule of ${new Date(at).toISOString()}`);
}

/** The process ticker, emulated: one tick at each 15 s step of the clock from `from` to `to` (inclusive). */
async function tickEvery(from: number, to: number): Promise<{ at: number; out: TickOutcome }[]> {
  const seen: { at: number; out: TickOutcome }[] = [];
  for (let t = from; t <= to; t += REBUILD_TICK_MS) {
    clock.t = t;
    const out = await tickRebuild(current);
    if (out.kind !== 'wait' && out.kind !== 'idle') seen.push({ at: t, out });
  }
  return seen;
}

async function clearPending(): Promise<void> {
  const p = await state.pending();
  if (p) await state.claim(p.dueAt, null);
}

beforeAll(async () => {
  deps = testDeps({ log: capture, clock }, { T2F_GITHUB_DISPATCH_TOKEN: TOKEN });
  const payload = payloadOf(deps);
  // The catalog season: seed it (idempotent) instead of relying on an earlier file.
  await runSeed(seedStoreOf(deps), baseSeedRows());
  site = createPayloadSiteStore({ payload, clock });
  state = createPayloadRebuildStore(payload);
  // The row exists before the first schedule (a real catalog change bumps the site version first).
  await site.inTransaction(null, (tx) => site.read(tx));
  fake = await dispatchFake();
  withToken = { ...rebuildDepsOf(deps, { dispatchBaseUrl: fake.base }), alarm: { raise: (a) => void alarms.push(a) }, sleep: async (ms) => void sleeps.push(ms) };
  current = withToken;
  const version = await withToken.catalogVersion();
  const meta = await deps.site?.snapshot.catalogMeta();
  if (!version || !meta) throw new Error('the test database has no catalog season');
  catalog = { version, at: meta.generatedAt };
  await clearPending();
  const row = createRebuildSubscriber(async () => current);
  bus = await startBackground(deps, [
    {
      ...row,
      async handle(event) {
        await row.handle(event);
        delivered += 1;
      },
    },
  ]);
});

beforeEach(async () => {
  await settleRebuilds();
  await clearPending();
  current = withToken;
  fake.mode = 'ok';
  fake.requests.length = 0;
  lines.length = 0;
  alarms.length = 0;
  sleeps.length = 0;
});

afterAll(async () => {
  await bus?.stop();
  await settleRebuilds();
  if (state) await clearPending();
  await fake?.close();
});

describe('catalog rebuild', { timeout: 60_000 }, () => {
  it('AC-61: 10 changes in 2 min → one launch 150 s after the last, through workflow_dispatch', async () => {
    const start = utc('2026-12-20T12:00:00');
    for (let i = 0; i < 10; i += 1) await change(start + i * 12_000);
    const last = start + 9 * 12_000;
    expect((await state.pending())?.dueAt).toBe(last + REBUILD_DEBOUNCE_MS);

    const seen = await tickEvery(start, last + REBUILD_DEBOUNCE_MS + 4 * REBUILD_TICK_MS);
    expect(seen.map((s) => s.out.kind)).toEqual(['launched']);
    const [launch] = seen;
    if (launch?.out.kind !== 'launched') throw new Error('no launch');
    expect(await launch.out.task).toEqual({ ok: true, attempts: 1 });
    expect(launch.at).toBeGreaterThanOrEqual(last + REBUILD_DEBOUNCE_MS);
    expect(launch.at).toBeLessThan(last + REBUILD_DEBOUNCE_MS + REBUILD_TICK_MS);

    expect(fake.requests).toHaveLength(1);
    const [req] = fake.requests;
    expect(req).toMatchObject({ method: 'POST', url: DISPATCH_PATH, auth: `Bearer ${TOKEN}`, accept: 'application/vnd.github+json' });
    expect(req?.body).toEqual({ ref: 'master', inputs: { env: 'rehearsal', reason: 'catalog-changed', catalogVersion: catalog.version } });
    expect(await state.pending()).toBeNull();
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });

  it('AC-62, AC-63: 3 changes in the freeze window → one site/rebuild-frozen, one launch at 14:00:xx (≤ 60 s)', async () => {
    const windowEnd = utc('2027-01-01T14:00:00');
    const changes = [utc('2026-12-31T20:00:00'), utc('2027-01-01T03:00:00'), utc('2027-01-01T13:59:00')];
    const seen: { at: number; out: TickOutcome }[] = [];
    for (const at of changes) {
      await change(at);
      // The ticker around this change's due time.
      seen.push(...(await tickEvery(at, Math.min(dueAfter(at) + REBUILD_TICK_MS, windowEnd - REBUILD_TICK_MS))));
    }
    expect(seen.map((s) => s.out.kind)).toEqual(['frozen']);
    expect(await state.pending()).toEqual({ dueAt: windowEnd, deferred: true });
    expect(fake.requests).toHaveLength(0);

    seen.push(...(await tickEvery(windowEnd - 4 * REBUILD_TICK_MS, windowEnd + 4 * REBUILD_TICK_MS)));
    const launches = seen.filter((s) => s.out.kind === 'launched');
    expect(launches).toHaveLength(1);
    expect(launches[0]?.at).toBeGreaterThanOrEqual(windowEnd);
    expect(launches[0]?.at).toBeLessThanOrEqual(windowEnd + 60_000);
    await settleRebuilds();
    expect(fake.requests).toHaveLength(1);
    expect(linesOf(REBUILD_FROZEN)).toHaveLength(1);
    expect(await state.pending()).toBeNull();
  });

  it('AC-65: no token → no launch and site/rebuild-not-configured per scheduled launch; the ticker starts', async () => {
    const bare = testDeps({ log: capture, clock }, { T2F_GITHUB_DISPATCH_TOKEN: undefined });
    current = { ...rebuildDepsOf(bare, { dispatchBaseUrl: fake.base }), sleep: async (ms) => void sleeps.push(ms) };
    expect(current.launcher).toBeUndefined();

    for (const at of [utc('2026-12-21T09:00:00'), utc('2026-12-21T10:00:00')]) {
      await change(at);
      const seen = await tickEvery(at, dueAfter(at) + REBUILD_TICK_MS);
      expect(seen.map((s) => s.out.kind)).toEqual(['not-configured']);
    }
    expect(linesOf(REBUILD_NOT_CONFIGURED)).toHaveLength(2);
    expect(fake.requests).toHaveLength(0);

    // Boot never fails without the token: the process ticker starts, ticks once (nothing pending) and stops.
    const ticker = startRebuildTicker(bare, 60_000);
    expect(ticker).toBeDefined();
    await ticker?.stop();
  });

  it('AC-66: a failing launch → 3 attempts at 0, 60, 300 s and one page alarm site/rebuild-failed', async () => {
    fake.mode = 'fail';
    const at = utc('2026-12-22T09:00:00');
    await change(at);
    const seen = await tickEvery(at, dueAfter(at) + REBUILD_TICK_MS);
    expect(seen.map((s) => s.out.kind)).toEqual(['launched']);
    const [launch] = seen;
    if (launch?.out.kind !== 'launched') throw new Error('no launch');
    expect(await launch.out.task).toEqual({ ok: false, attempts: 3 });
    expect(fake.requests).toHaveLength(3);
    expect(sleeps).toEqual([60_000, 240_000]);
    expect(alarms.filter((a) => a.code === REBUILD_FAILED)).toEqual([
      { level: 'page', source: 'site', code: REBUILD_FAILED, details: { catalogVersion: catalog.version, attempts: 3 } },
    ]);
    expect(JSON.stringify(lines)).not.toContain(TOKEN);
  });
});
