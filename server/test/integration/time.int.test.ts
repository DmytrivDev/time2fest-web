import { TimeResponseSchema } from '@time2fest/contracts/schemas';
import { describe, expect, it } from 'vitest';
import { buildDispatcher, createDeps } from '../../src/container';

const silent = { info: () => {}, warn: () => {}, error: () => {} };

describe('GET /api/time', () => {
  it('AC-40: bare { now } from the clock with the headers of functions/api/time.ts, no envelope', async () => {
    const deps = createDeps({ ...process.env, T2F_ENV: 'test', T2F_TEST_DOORS: undefined }, { log: silent });
    const dispatch = await buildDispatcher(deps);
    const before = Date.now();
    const res = await dispatch(new Request('http://server.test/api/time'));
    const after = Date.now();

    expect(res.status).toBe(200);
    expect([...res.headers.entries()].sort()).toEqual([
      ['cache-control', 'no-store, max-age=0'],
      ['content-type', 'application/json; charset=utf-8'],
      ['x-robots-tag', 'noindex'],
    ]);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['now']);
    expect(Number.isInteger(body.now)).toBe(true);
    expect(body.now as number).toBeGreaterThanOrEqual(0);
    expect(TimeResponseSchema.safeParse(body).success).toBe(true);
    // The test clock is not moved by this file: it reads real time.
    expect(body.now as number).toBeGreaterThanOrEqual(before - 2_000);
    expect(body.now as number).toBeLessThanOrEqual(after + 2_000);
  });
});
