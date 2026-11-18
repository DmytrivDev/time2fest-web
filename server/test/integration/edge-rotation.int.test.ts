/**
 * SPEC-13a AC-35 (and AC-5 for `/api/health`): with `T2F_EDGE_SECRET_PREVIOUS` set, the full dispatcher answers a request
 * carrying either secret; any other value gets the single 404 of an unknown path, byte-equal.
 * In-process dispatcher against this slot's Redis, no server.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, payloadOf } from '../../src/container';
import { BASE, ownRedis, testDeps } from './helpers';

// Built at runtime: no secret-looking literal in the test.
const CURRENT = randomBytes(24).toString('hex');
const PREVIOUS = randomBytes(24).toString('hex');
const OTHER = randomBytes(24).toString('hex');
const redis = ownRedis();

// `/api/health` has a 2 s cap; the first Payload start may take longer, so start it once up front.
beforeAll(async () => {
  await payloadOf(testDeps({ redis }))();
});

afterAll(async () => {
  await redis.close();
});

const get = (path: string, edge?: string) =>
  new Request(BASE + path, { headers: edge === undefined ? {} : { 'x-t2f-edge': edge } });

async function shape(res: Response) {
  const headers = [...res.headers.entries()].filter(([k]) => k !== 'date').sort(([a], [b]) => a.localeCompare(b));
  return { status: res.status, body: await res.text(), headers };
}

describe('edge secret rotation (SPEC-13a AC-35, real Redis)', () => {
  for (const [label, cls] of [
    ['test with a secret', {}],
    ['rehearsal', { T2F_ENV: 'rehearsal' }],
  ] as const) {
    it(`${label}: GET /api/time with the current or the previous secret → 200; a third value → the single 404`, async () => {
      const dispatch = await buildDispatcher(
        testDeps({ redis }, { ...cls, T2F_EDGE_SECRET: CURRENT, T2F_EDGE_SECRET_PREVIOUS: PREVIOUS }),
      );
      expect((await dispatch(get('/api/time', CURRENT))).status).toBe(200);
      expect((await dispatch(get('/api/time', PREVIOUS))).status).toBe(200);
      expect((await dispatch(get('/api/health', CURRENT))).status).toBe(200);
      expect((await dispatch(get('/api/health', PREVIOUS))).status).toBe(200);

      const unknown = await shape(await dispatch(get('/api/nope')));
      expect(unknown.status).toBe(404);
      for (const refused of [
        await shape(await dispatch(get('/api/time', OTHER))),
        await shape(await dispatch(get('/api/time'))),
        await shape(await dispatch(get('/api/health', OTHER))),
        await shape(await dispatch(get('/api/health'))),
        await shape(await dispatch(get('/api/nope', PREVIOUS.slice(0, 32)))),
      ]) {
        expect(refused).toEqual(unknown);
      }
    });
  }

  it('previous unset: the old secret is refused like any other value', async () => {
    const dispatch = await buildDispatcher(testDeps({ redis }, { T2F_EDGE_SECRET: CURRENT, T2F_EDGE_SECRET_PREVIOUS: '' }));
    expect((await dispatch(get('/api/time', CURRENT))).status).toBe(200);
    const unknown = await shape(await dispatch(get('/api/nope')));
    expect(await shape(await dispatch(get('/api/time', PREVIOUS)))).toEqual(unknown);
    expect(await shape(await dispatch(get('/api/health', PREVIOUS)))).toEqual(unknown);
  });
});
