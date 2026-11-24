import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildDispatcher } from '../../src/container';
import { doorRegistry } from '../../src/test-doors/registry';
import type { AppEnv, Deps } from '../../src/endpoints/types';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';

const evaluated = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/test-doors/index', () => {
  evaluated.count += 1;
  return { createDoors: () => ({ routes: [], subjects: { resolve: async () => null } }) };
});

const silent = { info: () => {}, warn: () => {}, error: () => {} };

function depsFor(cls: AppEnv['class'], doorsFlag: boolean): Deps {
  return {
    env: { class: cls, vars: doorsFlag ? { T2F_TEST_DOORS: '1' } : {} },
    clock: realClock,
    log: silent,
    alarm: { raise: () => {} },
    lockState: { holdsExclusive: () => false },
    redis: createMemoryStore(realClock),
    memory: createMemoryStore(realClock),
    orderStore: { begin: () => Promise.reject(new Error('not used')), finish: async () => {}, abort: async () => {} },
  };
}

async function snapshot(res: Response) {
  return { status: res.status, body: await res.text(), headers: [...res.headers.entries()].sort() };
}

describe('test doors gating', () => {
  it('AC-29: the doors module is evaluated only for the test class with T2F_TEST_DOORS=1', async () => {
    await buildDispatcher(depsFor('rehearsal', true));
    await buildDispatcher(depsFor('production', true));
    await buildDispatcher(depsFor('test', false));
    expect(evaluated.count).toBe(0);
    const testDeps = depsFor('test', true);
    await buildDispatcher(testDeps);
    expect(evaluated.count).toBe(1);
    // AC-57: the doors' subject resolver reaches the routes only; the built deps are left untouched.
    expect(testDeps.subjects).toBeUndefined();
  });

  it('AC-31: in production, headers, query and cookies naming doors still get the unknown-path 404', async () => {
    const dispatch = await buildDispatcher(depsFor('production', true));
    const unknown = await snapshot(await dispatch(new Request('http://server.test/api/nope')));
    expect(unknown.status).toBe(404);
    const attempts = [
      new Request('http://server.test/api/_test/clock', { headers: { 'X-T2F-Test-Doors': '1' } }),
      new Request('http://server.test/api/_test/clock?doors=1'),
      new Request('http://server.test/api/_test/clock', { headers: { Cookie: 't2f_env=test' } }),
      new Request('http://server.test/api/_test/clock?doors=1&t2f_env=test', {
        method: 'POST',
        body: '{"speed":60}',
        headers: { 'X-T2F-Test-Doors': '1', Cookie: 't2f_env=test; T2F_TEST_DOORS=1', 'X-T2F-Env': 'test' },
      }),
      new Request('http://server.test/api/_test/realtime-token', {
        method: 'POST',
        body: '{"subject":{"kind":"guest","id":"g1"}}',
        headers: { 'content-type': 'application/json', 'X-T2F-Test-Doors': '1', 'X-T2F-Env': 'test' },
      }),
    ];
    for (const req of attempts) expect(await snapshot(await dispatch(req))).toEqual(unknown);
  });

  it('SPEC-07 AC-67: in production the scheduler doors answer exactly like an unknown path', async () => {
    const dispatch = await buildDispatcher(depsFor('production', true));
    const unknownGet = await snapshot(await dispatch(new Request('http://server.test/api/nope')));
    const unknownPost = await snapshot(
      await dispatch(new Request('http://server.test/api/nope', { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } })),
    );
    expect(unknownGet.status).toBe(404);
    const doors: Array<[string, string, string]> = [
      ['POST', '/api/_test/scheduler/night-run', '{"speed":60}'],
      ['GET', '/api/_test/scheduler/night-run', ''],
      ['POST', '/api/_test/scheduler/lease', '{"action":"pause"}'],
      ['POST', '/api/_test/scheduler/fault', '{"after":"publish"}'],
    ];
    for (const [method, p, body] of doors) {
      const req =
        method === 'GET'
          ? new Request(`http://server.test${p}`, { headers: { 'X-T2F-Test-Doors': '1' } })
          : new Request(`http://server.test${p}`, { method, body, headers: { 'content-type': 'application/json', 'X-T2F-Test-Doors': '1' } });
      expect(await snapshot(await dispatch(req)), `${method} ${p}`).toEqual(method === 'GET' ? unknownGet : unknownPost);
    }
  });

  it('SPEC-12 AC-72: in production the live door answers exactly like an unknown path, whatever its body', async () => {
    const dispatch = await buildDispatcher(depsFor('production', true));
    const post = (p: string, body: string) =>
      dispatch(new Request(`http://server.test${p}`, { method: 'POST', body, headers: { 'content-type': 'application/json', 'X-T2F-Test-Doors': '1' } }));
    const unknown = await snapshot(await post('/api/nope', '{}'));
    expect(unknown.status).toBe(404);
    for (const body of ['{}', '{"door":"reset-live"}', '{"door":"viewers","people":12480,"countries":["UA"]}', '{"door":"video-status","videoId":"abcdefghijk","state":"live"}']) {
      expect(await snapshot(await post('/api/_test/live', body)), body).toEqual(unknown);
    }
    expect(await snapshot(await post('/api/_test/video-status', '{}'))).toEqual(unknown);
  });

  it('SPEC-07 AC-68: the registry has 20 door rows (SPEC-08 W19: + site; SPEC-12 W38: video-status → live; SPEC-13b W18: + ops-tick), and the production e2e list names exactly them', () => {
    expect(doorRegistry).toHaveLength(20);
    expect(doorRegistry.find((d) => d.key === 'ops-tick')).toMatchObject({ method: 'POST', path: '/api/_test/ops-tick' });
    expect(doorRegistry.find((d) => d.key === 'live')).toMatchObject({ method: 'POST', path: '/api/_test/live' });
    expect(doorRegistry.some((d) => d.key === 'video-status')).toBe(false);
    const rows = doorRegistry.map((d) => `${d.method} ${d.path}`).sort();
    const e2e = fs.readFileSync(path.resolve(__dirname, '../e2e/doors-404.e2e.ts'), 'utf8');
    const listed = [...e2e.matchAll(/\['(GET|POST)', '(\/api\/_test\/[^']+)'\]/g)].map((m) => `${m[1]} ${m[2]}`).sort();
    expect(listed).toEqual(rows);
  });
});
