import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTestClock } from '../../src/clock';
import { buildDispatcher, createDeps, createLockState, seedStoreOf } from '../../src/container';
import { createDispatcher } from '../../src/endpoints/pipeline';
import { inactiveEdgeGate } from '../../src/platform/edge';
import type { Deps } from '../../src/endpoints/types';
import { middlewareRegistry } from '../../src/registries/middleware';
import { routeRegistry } from '../../src/registries/routes';
import { doorRoutes } from '../../src/test-doors/index';

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

describe('test doors', () => {
  afterEach(() => {
    createTestClock().reset();
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

  it('AC-32: the four stub doors → 501 with the exact body', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    for (const door of ['last-code', 'moderation', 'paypro-webhook', 'video-status']) {
      const res = await dispatch(new Request(`${BASE}/api/_test/${door}`, { method: 'POST', body: '{}', headers: JSON_TYPE }));
      expect(res.status, door).toBe(501);
      expect(await res.text()).toBe('{"ok":false,"error":{"code":"unavailable"}}');
    }
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
    // Even a moved test clock does not reach the rehearsal clock.
    createTestClock().set({ at: Date.parse('2030-01-01T00:00:00Z'), frozen: true });
    expect(Math.abs((await now(dispatch)) - Date.now())).toBeLessThanOrEqual(2_000);
    expect(routeRegistry.every((r) => !r.path.startsWith('/api/_test/'))).toBe(true);
  });

  it('AC-39 (reset half): after reset the clock is real time, speed 1, not frozen', async () => {
    const dispatch = await buildDispatcher(depsFor('test'));
    expect((await setClock(dispatch, { at: Date.parse('2031-01-01T00:00:00Z'), speed: 600, frozen: true })).status).toBe(200);
    createTestClock().reset();
    const state = await clockState(dispatch);
    expect(state.speed).toBe(1);
    expect(state.frozen).toBe(false);
    expect(Math.abs((await now(dispatch)) - Date.now())).toBeLessThanOrEqual(2_000);
  });
});
