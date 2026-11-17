/**
 * `GET /api/catalog` (AC-63, AC-65, AC-66, NFR-2, NFR-3) on the `_test` database, after `import catalog --apply`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiFailureSchema, CatalogResponseSchema } from '@time2fest/contracts/schemas';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, catalogStoreOf, payloadOf } from '../../src/container';
import { nonMidnightEvents } from '../../src/catalog/service';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { BASE, ownRedis, testDeps } from './helpers';
import { IMPORT_CONTEXT, KINDS } from './catalog-helpers';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const redis = ownRedis();
const SILENT = { ...IMPORT_CONTEXT, t2fInternal: true };

describe('GET /api/catalog', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let dispatch: (req: Request) => Promise<Response>;

  const get = () => dispatch(new Request(`${BASE}/api/catalog`));
  const resetLimit = () => redis.deleteByPrefix('rl:catalog-read');

  beforeAll(async () => {
    deps = testDeps({ redis });
    payload = await payloadOf(deps)();
    for (const kind of [...KINDS].reverse()) {
      await payload.delete({ collection: kind, where: { id: { exists: true } }, overrideAccess: true, context: SILENT });
    }
    const row = importRegistry.find((r) => r.key === 'catalog');
    const applied = await row?.run({
      apply: true,
      deps,
      readSource: (file) => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8')),
    });
    expect(applied?.code).toBe(0);
    dispatch = await buildDispatcher(deps);
  }, 300_000);

  afterAll(async () => {
    await payload.delete({ collection: 'events', where: { eventId: { like: 'evt-read-' } }, overrideAccess: true, context: SILENT });
    await resetLimit();
    await redis.close();
  });

  it('AC-63: the body passes the shared schema and has the data files as its content', async () => {
    await resetLimit();
    const res = await get();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(CatalogResponseSchema.safeParse(body).success).toBe(true);
    const value = body.value;
    expect(JSON.stringify(value.schedule)).toBe(JSON.stringify(JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8'))));
    expect(value.version).toBe(`${value.schedule.generatedAt}+${value.schedule.tzdbVersion}`);
  });

  it('AC-66: a fireworks-20 event is not in the body and is returned by the port with startsAt', async () => {
    await resetLimit();
    const city = (await payload.find({ collection: 'cities', where: { cityId: { equals: 'auckland' } }, overrideAccess: true, depth: 0 })).docs[0];
    if (!city) throw new Error('fixture: auckland');
    await payload.create({
      collection: 'events',
      overrideAccess: true,
      context: SILENT,
      data: {
        eventId: 'evt-read-fireworks',
        cityId: 'auckland',
        zoneId: String(city.zoneId),
        countryIso: String(city.countryIso),
        midnightUtc: '2026-12-31T11:00:00Z',
        isMainCelebration: false,
        slot: 'fireworks-20',
        startsAt: '2026-12-31T07:00:00.000Z',
      },
    });
    const body = await (await get()).json();
    expect(JSON.stringify(body)).not.toContain('evt-read-fireworks');
    const port = await nonMidnightEvents(catalogStoreOf(deps));
    expect(port.find((e) => e.eventId === 'evt-read-fireworks')).toMatchObject({ slot: 'fireworks-20', startsAt: '2026-12-31T07:00:00.000Z' });
  });

  it('AC-65: an event with a missing zone, inserted past the checks, makes the read unavailable / catalog-invalid', async () => {
    await resetLimit();
    await payload.create({
      collection: 'events',
      overrideAccess: true,
      context: SILENT,
      data: {
        eventId: 'evt-read-broken',
        cityId: 'auckland',
        zoneId: 'utc+9999',
        countryIso: 'NZ',
        midnightUtc: '2026-12-31T11:00:00Z',
        isMainCelebration: false,
      } as never,
    });
    const res = await get();
    expect(res.status).toBe(503);
    const body = ApiFailureSchema.parse(await res.json());
    expect(body.error).toMatchObject({ code: 'unavailable', reason: 'catalog-invalid' });
    await payload.delete({ collection: 'events', where: { eventId: { equals: 'evt-read-broken' } }, overrideAccess: true, context: SILENT });
  });

  it('NFR-2: 20 requests, p95 printed and at most 1 000 ms; body at most 2 MB', async () => {
    await resetLimit();
    const times: number[] = [];
    let bytes = 0;
    for (let i = 0; i < 20; i += 1) {
      const t = Date.now();
      const res = await get();
      const text = await res.text();
      times.push(Date.now() - t);
      bytes = Math.max(bytes, Buffer.byteLength(text));
      expect(res.status).toBe(200);
    }
    times.sort((a, b) => a - b);
    const p95 = times[Math.ceil(times.length * 0.95) - 1] ?? 0;
    console.log(`NFR-2: p95 ${p95} ms, body ${bytes} bytes`);
    expect(p95).toBeLessThanOrEqual(1000);
    expect(bytes).toBeLessThanOrEqual(2 * 1024 * 1024);
  });

  it('NFR-3: the 31st request in a minute is rate_limited with retryAfterMs', async () => {
    await resetLimit();
    for (let i = 0; i < 30; i += 1) expect((await get()).status).toBe(200);
    const res = await get();
    expect(res.status).toBe(429);
    const body = ApiFailureSchema.parse(await res.json());
    expect(body.error.code).toBe('rate_limited');
    expect(body.error.retryAfterMs).toBeGreaterThan(0);
  });
});
