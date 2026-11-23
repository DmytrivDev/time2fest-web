import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPayloadClockStateStore } from '../../src/adapters/payloadClockState';
import { createTestClock, realClock } from '../../src/clock';
import { buildDispatcher, createDeps, createLockState, payloadOf, seedStoreOf } from '../../src/container';
import { initialState } from '../../src/domain/timekeeping/virtual';
import { createSharedClock } from '../../src/timekeeping/shared';
import { createDispatcher } from '../../src/endpoints/pipeline';
import { inactiveEdgeGate } from '../../src/platform/edge';
import type { Deps } from '../../src/endpoints/types';
import { middlewareRegistry } from '../../src/registries/middleware';
import { routeRegistry } from '../../src/registries/routes';
import { doorRoutes } from '../../src/test-doors/index';
import { SITE_R2_KEYS, type SiteState, type ViewerSummary } from '@time2fest/contracts';
import { SiteStateSchema } from '@time2fest/contracts/schemas';
import { createPayloadFanOutClaim } from '../../src/adapters/payloadSiteState';
import { liveOf, siteOf } from '../../src/endpoints/deps';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import { deleteUnder, listKeys, r2Env, readObject } from './r2-helpers';
import { quotaDay } from '../../src/domain/live/quota';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';

const BASE = 'http://127.0.0.1:3000';
const JSON_TYPE = { 'content-type': 'application/json' };
const SLUG = 'doors_int_test';
const silent = { info: () => {}, warn: () => {}, error: () => {} };

// Rehearsal requires the edge secret since SPEC-05 AC-14; built at runtime, sent by `viaEdge`.
const EDGE_SECRET = randomBytes(24).toString('hex');

function depsFor(cls: 'test' | 'rehearsal', overrides: Partial<Omit<Deps, 'env'>> = {}): Deps {
  const edge = cls === 'rehearsal' ? { T2F_EDGE_SECRET: EDGE_SECRET } : {};
  return createDeps({ ...process.env, T2F_ENV: cls, T2F_TEST_DOORS: '1', T2F_SLUG: SLUG, ...edge }, { log: silent, ...overrides });
}

/** Sends every request as the edge Worker would, so the rehearsal gate admits it. */
function viaEdge(dispatch: (r: Request) => Promise<Response>): (r: Request) => Promise<Response> {
  return (r) => {
    const headers = new Headers(r.headers);
    headers.set('x-t2f-edge', EDGE_SECRET);
    return dispatch(new Request(r, { headers }));
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function now(dispatch: (r: Request) => Promise<Response>): Promise<number> {
  return ((await (await dispatch(new Request(`${BASE}/api/time`))).json()) as { now: number }).now;
}

async function clockState(dispatch: (r: Request) => Promise<Response>) {
  const res = await dispatch(new Request(`${BASE}/api/_test/clock`));
  expect(res.status).toBe(200);
  return ((await res.json()) as { value: { now: number; speed: number; frozen: boolean } }).value;
}

const setClock = (dispatch: (r: Request) => Promise<Response>, body: unknown) =>
  dispatch(new Request(`${BASE}/api/_test/clock`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));

/** The test clock over the shared clock of this process (every `test` deps set shares its cache). */
const testClock = () => createTestClock(depsFor('test').sharedClock!);

describe('test doors', () => {
  afterEach(async () => {
    await testClock().reset();
  });

  it('AC-35: at set with speed 1 → /api/time starts at `at` and advances', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    const at = Date.parse('2026-12-31T23:59:00Z');
    const res = await setClock(dispatch, { at, speed: 1, frozen: false });
    expect(res.status).toBe(200);
    const t = await now(dispatch);
    expect(Math.abs(t - at)).toBeLessThanOrEqual(500);
    await sleep(50);
    expect(await now(dispatch)).toBeGreaterThan(t);
  });

  it('AC-36: speed 60 advances 60 ms per real ms', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await setClock(dispatch, { speed: 60, frozen: false })).status).toBe(200);
    const r0 = Date.now();
    const v0 = await now(dispatch);
    await sleep(1_000);
    const v1 = await now(dispatch);
    const real = Date.now() - r0;
    expect(real).toBeGreaterThanOrEqual(990);
    // 60 virtual ms per real ms over the measured wait (≈1 000 ms) → +60 000 ± 1 000.
    expect(Math.abs(v1 - v0 - 60 * real)).toBeLessThanOrEqual(1_000);
  });

  it('AC-37: a frozen clock returns the same instant', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await setClock(dispatch, { at: Date.parse('2026-12-31T12:00:00Z'), frozen: true })).status).toBe(200);
    const a = await now(dispatch);
    await sleep(500);
    const b = await now(dispatch);
    await sleep(500);
    const c = await now(dispatch);
    expect([b, c]).toEqual([a, a]);
  });

  it('AC-38: a bad speed or at → 400 invalid-input and the clock state is unchanged', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await setClock(dispatch, { at: Date.parse('2026-12-31T12:00:00Z'), speed: 7, frozen: true })).status).toBe(200);
    const before = await clockState(dispatch);
    for (const body of [{ speed: 601 }, { speed: -1 }, { speed: 1.5 }, { at: -5 }]) {
      const res = await setClock(dispatch, body);
      expect(res.status, JSON.stringify(body)).toBe(400);
      const err = ((await res.json()) as { error: Record<string, unknown> }).error;
      expect(err.code).toBe('validation');
      expect(err.reason).toBe('invalid-input');
    }
    expect(await clockState(dispatch)).toEqual(before);
  });

  it('AC-32: the stub doors → 501 with the exact body (moderation is real since SPEC-09, video-status is the live door since SPEC-12)', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    for (const door of ['last-code', 'paypro-webhook']) {
      const res = await dispatch(new Request(`${BASE}/api/_test/${door}`, { method: 'POST', body: '{}', headers: JSON_TYPE }));
      expect(res.status, door).toBe(501);
      expect(await res.text()).toBe('{"ok":false,"error":{"code":"unavailable"}}');
    }
  });

  it('SPEC-09 AC-50: the moderation door answers in test (status, reset, rules verdict); a bad op is invalid-input', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    const call = (body: unknown) =>
      dispatch(new Request(`${BASE}/api/_test/moderation`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
    const reset = await call({ op: 'reset' });
    expect(reset.status).toBe(200);
    expect(await reset.json()).toEqual({ ok: true, value: { op: 'reset' } });
    const status = (await (await call({ op: 'status' })).json()) as { value: { statuses: { task: string }[] } };
    expect(status.value.statuses.map((s) => s.task)).toEqual(['moderation', 'translation']);
    const verdict = await call({ op: 'verdict', kind: 'nick', text: 'a' });
    expect(await verdict.json()).toEqual({ ok: true, value: { op: 'verdict', outcome: 'block', source: 'rules', reason: 'short' } });
    const bad = await call({ op: 'nope' });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { reason: string } }).error.reason).toBe('invalid-input');
  });

  it('doors refuse a foreign Origin, a non-JSON call and a non-loopback Host; tooling without Origin passes', async () => {
    const deps = createDeps(
      { ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: '1', T2F_SLUG: SLUG, T2F_ALLOWED_ORIGINS: 'http://allowed.test' },
      { log: silent },
    );
    const dispatch = await buildDispatcher(deps);
    const at = Date.parse('2026-12-31T23:00:00Z');
    const set = (base: string, headers: Record<string, string>) =>
      dispatch(new Request(`${base}/api/_test/clock`, { method: 'POST', body: JSON.stringify({ at, frozen: true }), headers }));
    const forbidden = { ok: false, error: { code: 'forbidden' } };
    const before = await clockState(dispatch);

    const refused: [string, Record<string, string>][] = [
      [BASE, { ...JSON_TYPE, origin: 'http://evil.test' }], // foreign Origin
      [BASE, { ...JSON_TYPE, origin: 'null' }],
      [BASE, { 'content-type': 'text/plain' }], // no-cors / form-like body without Origin
      [BASE, { 'content-type': 'application/x-www-form-urlencoded', origin: 'http://allowed.test' }],
      ['http://rebound.example:3000', JSON_TYPE], // DNS rebinding: Host is not loopback
      ['http://10.0.0.5:3000', JSON_TYPE],
    ];
    for (const [base, headers] of refused) {
      const res = await set(base, headers);
      expect(res.status, `${base} ${JSON.stringify(headers)}`).toBe(403);
      expect(await res.json()).toEqual(forbidden);
    }
    const wipe = await dispatch(new Request(`${BASE}/api/_test/reset`, { method: 'POST', body: '{}', headers: { 'content-type': 'text/plain' } }));
    expect(wipe.status).toBe(403);
    expect((await dispatch(new Request('http://rebound.example/api/_test/clock'))).status).toBe(403);
    const after = await clockState(dispatch);
    expect(after.frozen).toBe(before.frozen);
    expect(after.frozen).toBe(false); // no refused call reached the clock
    expect(after.now).not.toBe(at);

    for (const [base, headers] of [
      [BASE, JSON_TYPE], // tooling: no Origin
      [BASE, { 'content-type': 'application/json; charset=utf-8', origin: 'http://allowed.test' }],
      ['http://localhost:4001', JSON_TYPE],
      ['http://[::1]:4001', JSON_TYPE],
    ] as [string, Record<string, string>][]) {
      expect((await set(base, headers)).status, `${base} ${JSON.stringify(headers)}`).toBe(200);
    }
    expect(await clockState(dispatch)).toMatchObject({ now: at, frozen: true });
  });

  it('AC-33: a dependency-breaking door runs only while this worktree holds the exclusive lock', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-lock-'));
    try {
      const deps = depsFor('test', { lockState: createLockState(dir) });
      const handler = vi.fn(async () => ({ ok: true as const, value: 'broken' }));
      const routes = doorRoutes(deps, seedStoreOf(deps), [{ key: 'break-db', method: 'POST', path: '/api/_test/break-db', dependencyBreaking: true, handler }]);
      const dispatch = createDispatcher({ routes, middleware: middlewareRegistry, deps, edge: inactiveEdgeGate(deps.clock) });
      const call = () => dispatch(new Request(`${BASE}/api/_test/break-db`, { method: 'POST', body: '{}', headers: JSON_TYPE }));

      const refused = await call();
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ ok: false, error: { code: 'forbidden', reason: 'lock-required' } });
      expect(handler).not.toHaveBeenCalled();

      const at = new Date(Date.now()).toISOString();
      const holder = (owner: string) => ({ owner, mode: 'exclusive', pid: process.pid, startedAt: at, leaseAt: at });
      fs.writeFileSync(path.join(dir, 'integration.json'), JSON.stringify({ holders: [holder(`other_slug:1`)] }));
      expect((await call()).status).toBe(403);
      fs.writeFileSync(path.join(dir, 'integration.json'), '{ not json');
      expect((await call()).status).toBe(403);
      expect(handler).not.toHaveBeenCalled();

      fs.writeFileSync(path.join(dir, 'integration.json'), JSON.stringify({ holders: [holder(`${SLUG}:${process.pid}`)] }));
      const ran = await call();
      expect(ran.status).toBe(200);
      expect(handler).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('AC-21: rehearsal with T2F_TEST_DOORS=1 has no doors and real time', async () => {
    const deps = depsFor('rehearsal');
    const dispatch = viaEdge(await buildDispatcher(deps));
    const missing = await dispatch(new Request(`${BASE}/api/_test/clock`));
    const unknown = await dispatch(new Request(`${BASE}/api/nope`));
    expect(missing.status).toBe(404);
    expect(await missing.text()).toBe(await unknown.text());
    // While the shared clock is real, rehearsal time is real time. (SPEC-07 AC-1: a virtual clock set
    // for this environment does reach rehearsal — only through its own store, never a door.)
    expect(Math.abs((await now(dispatch)) - Date.now())).toBeLessThanOrEqual(2_000);
    expect(routeRegistry.every((r) => !r.path.startsWith('/api/_test/'))).toBe(true);
  });

  it('SPEC-07 W14: the door state persists across two dispatchers and is stored, not only cached', async () => {
    const at = Date.parse('2030-06-01T00:00:00Z');
    const first = await buildDispatcher(depsFor('test'));
    expect((await setClock(first, { at, speed: 60, frozen: true })).status).toBe(200);
    const second = await buildDispatcher(depsFor('test'));
    expect(await clockState(second)).toEqual({ now: at, speed: 60, frozen: true });
    // A process with an empty cache (a restart) reads the same state from the store.
    const stored = createSharedClock({ store: createPayloadClockStateStore({
      payload: payloadOf(depsFor('test')),
      journal: { append: async () => {} },
      publisher: { publish: async () => ({ version: 0 }) },
      real: realClock,
    }), real: realClock, cache: { state: initialState(0) } });
    await stored.refresh();
    expect(stored.view()).toEqual({ now: at, speed: 60, frozen: true });
  });

  it('AC-39 (reset half): after reset the clock is real time, speed 1, not frozen', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await setClock(dispatch, { at: Date.parse('2031-01-01T00:00:00Z'), speed: 600, frozen: true })).status).toBe(200);
    await testClock().reset();
    const state = await clockState(dispatch);
    expect(state.speed).toBe(1);
    expect(state.frozen).toBe(false);
    expect(Math.abs((await now(dispatch)) - Date.now())).toBeLessThanOrEqual(2_000);
  });
});

/**
 * SPEC-08 AC-68 (W19): `POST /api/_test/site` in the `test` class — switch, products fake, select, red button in
 * the test bucket, reset (version 1 and `last_fanned_out` 0) — and the unknown-path 404 in `rehearsal`.
 */
describe('site door', { timeout: 120_000 }, () => {
  const run = `sd${Date.now()}`;
  const r2 = r2Env();
  const redKey = `${r2.prefix}${SITE_R2_KEYS.redButton}`;
  const siteDoor = (dispatch: (r: Request) => Promise<Response>, body: unknown) =>
    dispatch(new Request(`${BASE}/api/_test/site`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
  const state = async (dispatch: (r: Request) => Promise<Response>): Promise<SiteState> => {
    const res = await dispatch(new Request(`${BASE}/api/site/state`));
    expect(res.status, await res.clone().text()).toBe(200);
    return SiteStateSchema.parse(await res.json()) as SiteState;
  };

  beforeAll(async () => {
    // The snapshot reads the season catalog: seed it (idempotent).
    await runSeed(seedStoreOf(depsFor('test')), baseSeedRows());
    await deleteUnder(r2, redKey);
  });

  afterAll(async () => {
    await siteOf(depsFor('test')).resetForTests?.();
    await deleteUnder(r2, redKey);
  });

  it('AC-68: switch (key, value, mode) → the snapshot changes under a higher version', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await siteDoor(dispatch, { action: 'reset' })).status).toBe(200);
    expect((await state(dispatch)).version).toBe(1);
    const res = await siteDoor(dispatch, { action: 'switch', key: 'toastTiers', tier: '5', value: false, mode: 'manual', reason: `door ${run}` });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as { value: unknown }).value).toEqual({ version: 2, changed: true });
    const after = await state(dispatch);
    expect(after.switches.toastTiers['5']).toBe(false);
    expect(after.version).toBe(2);
    // A bad body is refused by the schema; nothing changes.
    expect((await siteDoor(dispatch, { action: 'switch', key: 'chat', value: 'no', mode: 'manual' })).status).toBe(400);
    expect((await state(dispatch)).version).toBe(2);
  });

  it('AC-68: products sets the fake, select chooses a listed product; an unknown id is refused', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await siteDoor(dispatch, { action: 'reset' })).status).toBe(200);
    const list = [
      { key: 'pass', productId: `pass-${run}`, price: { amount: 500, currency: 'USD' } },
      { key: 'toast:10', productId: `toast-${run}`, price: { amount: 1000, currency: 'USD' } },
    ];
    expect((await siteDoor(dispatch, { action: 'products', list })).status).toBe(200);
    expect((await siteDoor(dispatch, { action: 'select', key: 'toast:10', productId: `toast-${run}` })).status).toBe(200);
    expect((await state(dispatch)).products).toEqual([{ key: 'toast:10', price: { amount: 1000, currency: 'USD' }, priceVersion: 1 }]);
    const unknown = await siteDoor(dispatch, { action: 'select', key: 'pass', productId: `nope-${run}` });
    expect(unknown.status).toBe(400);
    expect(((await unknown.json()) as { error: unknown }).error).toEqual({ code: 'validation', reason: 'unknown-product' });
  });

  it('AC-68: redButton put writes the snapshot with outage technical to the test bucket; delete removes it', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await siteDoor(dispatch, { action: 'reset' })).status).toBe(200);
    const current = await state(dispatch);
    expect((await siteDoor(dispatch, { action: 'redButton', op: 'put' })).status).toBe(200);
    const stored = SiteStateSchema.parse(JSON.parse(await readObject(r2, redKey))) as SiteState;
    expect(stored).toEqual({ ...current, outage: 'technical' });
    expect((await siteDoor(dispatch, { action: 'redButton', op: 'delete' })).status).toBe(200);
    expect(await listKeys(r2, redKey)).toEqual([]);
    // Deleting an absent object is not an error.
    expect((await siteDoor(dispatch, { action: 'redButton', op: 'delete' })).status).toBe(200);
  });

  it('AC-68: reset → version 1, default switches, no products, empty fake, and nothing fanned out yet', async () => {
    const deps = depsFor('test');
    const dispatch = await buildDispatcher(deps);
    await siteDoor(dispatch, { action: 'products', list: [{ key: 'pass', productId: `pass-${run}`, price: { amount: 500, currency: 'USD' } }] });
    await siteDoor(dispatch, { action: 'select', key: 'pass', productId: `pass-${run}` });
    await siteDoor(dispatch, { action: 'switch', key: 'chat', value: false, mode: 'manual' });
    const changed = await state(dispatch);
    expect(changed.products).toHaveLength(1);
    const claim = createPayloadFanOutClaim(payloadOf(deps));
    expect(await claim.claim(changed.version)).toBe(true);

    expect((await siteDoor(dispatch, { action: 'reset' })).status).toBe(200);
    const reset = await state(dispatch);
    expect(reset.version).toBe(1);
    expect(reset.products).toEqual([]);
    expect(reset.switches).toMatchObject({ chat: true, toasts: true, pass: true, passGift: true, payments: true, viewersMap: true, passOffer: true });
    expect(reset.switches.toastTiers).toEqual({ '2': true, '5': true, '10': true });
    expect(await siteOf(deps).products.list()).toEqual([]);
    // `last_fanned_out` is back to 0: version 1 can be claimed again.
    expect(await claim.claim(1)).toBe(true);
    expect((await siteDoor(dispatch, { action: 'reset' })).status).toBe(200);
  });

  it('AC-68: in rehearsal the site door answers exactly like an unknown path', async () => {
    const dispatch = viaEdge(await buildDispatcher(depsFor('rehearsal')));
    const unknown = await dispatch(new Request(`${BASE}/api/_test/nope`, { method: 'POST', body: '{}', headers: JSON_TYPE }));
    const door = await siteDoor(dispatch, { action: 'reset' });
    expect(unknown.status).toBe(404);
    expect({ status: door.status, body: await door.text() }).toEqual({ status: unknown.status, body: await unknown.text() });
  });
});

/** The sim viewer list of `lib/presence/viewers.ts` (`simulatedViewers`): the 140 most popular countries, stable order. */
function simViewers(): { iso: string; name: string; flagCode: string }[] {
  const file = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../data/countries.json'), 'utf8')) as {
    countries: { iso: string; name: { uk: string }; flagCode: string; popularity: number }[];
  };
  return [...file.countries]
    .sort((a, b) => b.popularity - a.popularity)
    .slice(0, 140)
    .map((c) => ({ iso: c.iso, name: c.name.uk, flagCode: c.flagCode }));
}

describe('live door (SPEC-12 AC-72)', { timeout: 120_000 }, () => {
  type Fake = { url: string; close: () => Promise<void> };
  let fake: Fake;
  let deps: Deps;
  let dispatch: (r: Request) => Promise<Response>;
  const liveDoor = (body: unknown) => dispatch(new Request(`${BASE}/api/_test/live`, { method: 'POST', body: JSON.stringify(body), headers: JSON_TYPE }));
  const ok = async (res: Response) => {
    expect(res.status, await res.clone().text()).toBe(200);
    return ((await res.json()) as { value: Record<string, unknown> }).value;
  };
  const viewers = async () => {
    const res = await dispatch(new Request(`${BASE}/api/live/viewers`));
    return { status: res.status, text: await res.text() };
  };

  beforeAll(async () => {
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    deps = createDeps(
      { ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: '1', T2F_SLUG: SLUG, T2F_YOUTUBE_BASE_URL: fake.url },
      { log: silent },
    );
    // The viewer catalog and the events of the seeded stream sources.
    await runSeed(seedStoreOf(deps), baseSeedRows());
    dispatch = await buildDispatcher(deps);
    await ok(await liveDoor({ door: 'reset-live' }));
  });

  afterAll(async () => {
    await liveDoor({ door: 'reset-live' });
    await fake.close();
  });

  it('video-status sets the state of one video in the fake (missing → no item, not-embeddable → embeddable false)', async () => {
    const id = 'dOoRvIdEo01';
    const item = async () => {
      const res = await fetch(`${fake.url}/youtube/v3/videos?id=${id}&part=status`);
      return ((await res.json()) as { items: { status: { embeddable: boolean }; snippet: { liveBroadcastContent: string } }[] }).items[0];
    };
    await ok(await liveDoor({ door: 'video-status', videoId: id, state: 'live' }));
    expect(await item()).toMatchObject({ snippet: { liveBroadcastContent: 'live' }, status: { embeddable: true } });
    await ok(await liveDoor({ door: 'video-status', videoId: id, state: 'not-embeddable' }));
    expect((await item())?.status.embeddable).toBe(false);
    await ok(await liveDoor({ door: 'video-status', videoId: id, state: 'missing' }));
    expect(await item()).toBeUndefined();
    expect((await liveDoor({ door: 'video-status', videoId: id, state: 'gone' })).status).toBe(400);
  });

  it('quota sets the queries counter of the current quota day; exceeded stops the bucket; a lower value replaces', async () => {
    const live = liveOf(deps);
    const day = quotaDay(deps.clock.now(), live.cfg.dayTimeZone);
    expect(await ok(await liveDoor({ door: 'quota', used: 9_000, exceeded: true }))).toEqual({ day });
    let state = await live.quota.read(day);
    expect(state.queries?.used).toBe(9_000);
    expect(state.queries?.exceededUntil).toBeGreaterThan(deps.clock.now());
    await ok(await liveDoor({ door: 'quota', used: 120 }));
    state = await live.quota.read(day);
    expect(state.queries?.used).toBe(120);
    expect(state.queries?.exceededUntil ?? null).toBeNull();
  });

  it('viewers fixture → GET /api/live/viewers shows people 12 480 and the 140 sim countries in sim order', async () => {
    const sim = simViewers();
    expect(sim).toHaveLength(140);
    await ok(await liveDoor({ door: 'viewers', people: 12_480, countries: sim.map((c) => c.iso) }));
    const read = await viewers();
    expect(read.status, read.text).toBe(200);
    const { value } = JSON.parse(read.text) as { value: ViewerSummary };
    expect(value.people).toBe(12_480);
    expect(value.countries).toEqual(sim);
    // People cannot cover three entries per country → refused.
    expect((await liveDoor({ door: 'viewers', people: 10, countries: sim.map((c) => c.iso) })).status).toBe(400);
  });

  it('hide hides one seeded source as the owner (new version); reset-live brings it back and drops the fixtures', async () => {
    const live = liveOf(deps);
    const [source] = await live.store.sources();
    expect(source, 'the seed has stream sources').toBeDefined();
    const before = (await live.store.state()).version;
    const hidden = await ok(await liveDoor({ door: 'hide', eventId: source!.eventId, sourceId: source!.sourceId }));
    expect(hidden).toEqual({ version: before + 1, changed: true });
    expect((await live.store.sources({ sourceIds: [source!.sourceId] }))[0]?.hidden).toBe(true);
    expect((await liveDoor({ door: 'hide', eventId: source!.eventId, sourceId: 'no-such-source' })).status).toBe(404);

    await ok(await liveDoor({ door: 'quota', used: 50 }));
    await ok(await liveDoor({ door: 'reset-live' }));
    expect((await live.store.sources({ sourceIds: [source!.sourceId] }))[0]?.hidden ?? false).toBe(false);
    expect((await live.quota.read(quotaDay(deps.clock.now(), live.cfg.dayTimeZone))).queries).toBeUndefined();
    const read = await viewers();
    if (read.status === 200) expect((JSON.parse(read.text) as { value: ViewerSummary }).value.people).not.toBe(12_480);
  });

  it('in rehearsal the live door answers exactly like an unknown path', async () => {
    const rehearsal = viaEdge(await buildDispatcher(depsFor('rehearsal')));
    const unknown = await rehearsal(new Request(`${BASE}/api/_test/nope`, { method: 'POST', body: '{}', headers: JSON_TYPE }));
    const door = await rehearsal(new Request(`${BASE}/api/_test/live`, { method: 'POST', body: '{"door":"reset-live"}', headers: JSON_TYPE }));
    expect(unknown.status).toBe(404);
    expect({ status: door.status, body: await door.text() }).toEqual({ status: unknown.status, body: await unknown.text() });
  });
});
