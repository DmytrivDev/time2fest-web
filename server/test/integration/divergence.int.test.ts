/**
 * Edge-to-origin divergence through the real pipeline (SPEC-07 AC-10, AC-12): a rehearsal-class dispatcher
 * with an edge secret. The meter runs on an injected fake REAL clock (the windows are real-time, AC-14).
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildDispatcher, createDeps, payloadOf } from '../../src/container';
import { createDivergenceMeter } from '../../src/timekeeping/divergence';
import { NON_TEST_GOOGLE } from '../support/nonTestGoogle';

const BASE = 'http://127.0.0.1:3000';
const SLUG = 'divergence_int_test';
const WINDOW = 60_000;
const silent = { info: () => {}, warn: () => {}, error: () => {} };
const EDGE_SECRET = randomBytes(24).toString('hex');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('edge divergence (AC-10, AC-12)', () => {
  it('ignores the mark without the edge secret; three 300 ms windows with it give exactly one page row', async () => {
    const deps = createDeps({ ...process.env, ...NON_TEST_GOOGLE, T2F_ENV: 'rehearsal', T2F_TEST_DOORS: '1', T2F_SLUG: SLUG, T2F_EDGE_SECRET: EDGE_SECRET }, { log: silent });
    let t = 100 * WINDOW;
    const meter = createDivergenceMeter({ real: { now: () => t }, alarm: deps.alarm, log: silent, timers: { every: () => {} } });
    deps.divergence = meter;
    const dispatch = await buildDispatcher(deps);
    const payload = await payloadOf(deps)();
    const rows = async () =>
      (await payload.find({ collection: 'alarms', where: { code: { equals: 'edge-divergence' } }, overrideAccess: true, depth: 0 })).docs;
    for (const d of await rows()) await payload.delete({ collection: 'alarms', id: d.id, overrideAccess: true });

    const send = (secret: boolean, mark: string) =>
      dispatch(new Request(`${BASE}/api/time`, { headers: { ...(secret ? { 'x-t2f-edge': EDGE_SECRET } : {}), 'x-t2f-edge-now': mark } }));

    // No secret: the header is not used.
    await send(false, String(t - 300));
    t += WINDOW;
    meter.tick();
    expect(meter.current().value).toBe('unknown');

    // Malformed mark with the secret: ignored.
    for (const bad of ['abc', '-1', '1.5']) await send(true, bad);
    t += WINDOW;
    meter.tick();
    expect(meter.current().value).toBe('unknown');

    for (let i = 0; i < 3; i++) {
      expect((await send(true, String(t - 300))).status).toBe(200);
      t += WINDOW;
      meter.tick();
    }
    expect(meter.current()).toMatchObject({ value: 300, level: 'page', streak: 3 });

    for (let i = 0; i < 50 && (await rows()).length === 0; i++) await sleep(100);
    const found = await rows();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ source: 'clock', level: 'page' });
  });
});
