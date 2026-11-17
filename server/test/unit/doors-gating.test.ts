import { describe, expect, it, vi } from 'vitest';
import { buildDispatcher } from '../../src/container';
import type { AppEnv, Deps } from '../../src/endpoints/types';
import { createMemoryStore } from '../../src/adapters/redis';
import { realClock } from '../../src/clock';

const evaluated = vi.hoisted(() => ({ count: 0 }));

vi.mock('../../src/test-doors/index', () => {
  evaluated.count += 1;
  return { doorRoutes: () => [], doorSubjects: { resolve: async () => null } };
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
    await buildDispatcher(depsFor('test', true));
    expect(evaluated.count).toBe(1);
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
});
