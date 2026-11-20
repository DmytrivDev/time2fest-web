/**
 * `GET /api/site/state` on the worktree's test database (SPEC-08 AC-3, AC-8, AC-9, AC-18, AC-23 server half;
 * W17, W20, W21). Requests go through the real dispatcher of `test`-class deps built by `createDeps`, so the
 * composition root's wiring is what answers: the snapshot readers, the version bump of corrections (container),
 * of the catalog hook and of the import row.
 * - AC-3: with a session cookie → 200, the body passes `SiteStateSchema`, `Cache-Control` exactly
 *   `public, max-age=10`, no `Set-Cookie`; query parameters are ignored.
 * - AC-8: a correction −20 min with a `restrained` note → the same values in `eventPatches`, a higher version.
 * - AC-9: a catalog record changed (hook) and `import catalog` with changed data → `catalogVersion` changes
 *   and equals `catalogVersionOf(meta)` of the season; the site version grows.
 * - AC-18: `test` class without a fake call and the `rehearsal` class → the products port lists nothing and
 *   the snapshot has `products: []`.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { catalogVersionOf, type SiteState } from '@time2fest/contracts';
import { SiteStateSchema } from '@time2fest/contracts/schemas';
import { createLocalReq, type Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDispatcher, catalogStoreOf, createDeps, payloadOf } from '../../src/container';
import { saveCorrection } from '../../src/corrections/service';
import { correctionsOf, siteOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { readSnapshot } from '../../src/site/snapshot';
import { createTinyCatalog, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { BASE, silent, testDeps } from './helpers';

const run = `sr${Date.now()}`;
const MIN = 60_000;
const MIDNIGHT = Date.parse('2026-12-31T23:00:00Z');
const SYSTEM = { kind: 'system' as const, id: 'site-route', label: 'site-route' };
const EDGE_SECRET = randomBytes(24).toString('hex');

type Dispatch = (r: Request) => Promise<Response>;

let deps: Deps;
let payload: Payload;
let dispatch: Dispatch;

async function state(): Promise<SiteState> {
  const res = await dispatch(new Request(`${BASE}/api/site/state`));
  expect(res.status, await res.clone().text()).toBe(200);
  return SiteStateSchema.parse(await res.json()) as SiteState;
}

async function seasonVersion(): Promise<string> {
  const season = (await catalogStoreOf(deps).read()).season;
  if (!season) throw new Error('no season');
  return catalogVersionOf({ generatedAt: season.generatedAt, tzdbVersion: season.tzdbVersion });
}

beforeAll(async () => {
  deps = testDeps();
  payload = await payloadOf(deps)();
  dispatch = await buildDispatcher(deps);
});

describe('GET /api/site/state', { timeout: 120_000 }, () => {
  let tiny: TinyCatalog;

  beforeAll(async () => {
    tiny = await createTinyCatalog(payload, run);
    // A known starting record: version 1, defaults, nothing selected.
    await siteOf(deps).resetForTests?.();
  });

  afterAll(async () => {
    if (!payload) return;
    await payload.delete({ collection: 'event-patches', where: { eventId: { like: run } }, overrideAccess: true, context: { t2fTrusted: true } });
    await removeTinyCatalog(payload, run);
    await siteOf(deps).resetForTests?.();
  });

  it('AC-3: with a session cookie → 200, schema-valid bare snapshot, Cache-Control exactly public, max-age=10, no Set-Cookie', async () => {
    const res = await dispatch(
      new Request(`${BASE}/api/site/state?version=7&utm_source=x`, { headers: { cookie: 'payload-token=abc; t2f_session=def', accept: 'application/json' } }),
    );
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=10');
    expect(res.headers.get('set-cookie')).toBeNull();
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = (await res.json()) as Record<string, unknown>;
    expect('ok' in body).toBe(false);
    const parsed = SiteStateSchema.safeParse(body);
    expect(parsed.success, JSON.stringify(parsed.error?.issues)).toBe(true);
    expect(body.catalogVersion).toBe(await seasonVersion());
  });

  it('AC-8: a correction −20 min with a restrained note → the same values in eventPatches and a higher version', async () => {
    const before = await state();
    const saved = await saveCorrection(
      correctionsOf(deps),
      await createLocalReq({ context: { t2fTrusted: true } }, payload),
      { changes: { [tiny.keys.event]: { moment: MIDNIGHT - 20 * MIN, restrained: { note: 'Тихо' } } }, expectedVersions: { [tiny.keys.event]: 0 }, confirmWarnings: true },
      SYSTEM,
    );
    expect(saved.ok, JSON.stringify(saved)).toBe(true);
    const after = await state();
    expect(after.eventPatches[tiny.keys.event]).toMatchObject({ moment: MIDNIGHT - 20 * MIN, restrained: { note: 'Тихо' } });
    expect(after.version).toBeGreaterThan(before.version);
  });

  it('AC-9: a catalog record changed in the admin → catalogVersion = catalogVersionOf(meta), new value, higher version', async () => {
    const before = await state();
    await payload.update({ collection: 'traditions', id: tiny.ids.traditions, data: { text: { uk: `Новий текст ${run}` } }, overrideAccess: true });
    const after = await state();
    expect(after.catalogVersion).not.toBe(before.catalogVersion);
    expect(after.catalogVersion).toBe(await seasonVersion());
    expect(after.version).toBeGreaterThan(before.version);
  });

  it('AC-18: test class without a fake call → the products port lists nothing and the snapshot has products: []', async () => {
    expect(await siteOf(deps).products.list()).toEqual([]);
    expect((await state()).products).toEqual([]);
  });

  it('AC-18: rehearsal class → the empty products port, no fake, products: [] through its own dispatcher', async () => {
    const rehearsal = createDeps({ ...process.env, T2F_ENV: 'rehearsal', T2F_EDGE_SECRET: EDGE_SECRET }, { log: silent });
    const site = siteOf(rehearsal);
    expect(site.testProducts).toBeUndefined();
    expect(site.resetForTests).toBeUndefined();
    expect(await site.products.list()).toEqual([]);
    const read = await readSnapshot(site.snapshot);
    expect(read.ok && read.state.products).toEqual([]);
    const rehearsalDispatch = await buildDispatcher(rehearsal);
    const res = await rehearsalDispatch(new Request(`${BASE}/api/site/state`, { headers: { 'x-t2f-edge': EDGE_SECRET } }));
    expect(res.status, await res.clone().text()).toBe(200);
    expect(((await res.json()) as SiteState).products).toEqual([]);
  });
});

describe('GET /api/site/state after import catalog', { timeout: 600_000 }, () => {
  const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const dataDir = path.join(serverDir, '../data');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-site-route-'));
  const row = importRegistry.find((r) => r.key === 'catalog');
  const importFrom = async (dir: string) => {
    if (!row) throw new Error('registry: no catalog row');
    const result = await row.run({ apply: true, deps, readSource: (file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) });
    expect(result.code, result.lines.slice(0, 3).join('\n')).toBe(0);
    return result;
  };

  afterAll(async () => {
    // The real catalog back as in the data files.
    if (payload) await importFrom(dataDir);
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('AC-9: import catalog with changed data → catalogVersion changes and equals catalogVersionOf(meta); the site version grows', async () => {
    await importFrom(dataDir);
    const before = await state();
    fs.copyFileSync(path.join(dataDir, 'countries.json'), path.join(tmp, 'countries.json'));
    const schedule = JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8')) as {
      zones: { countries: { cities: { name: { uk: string } }[] }[] }[];
    };
    const city = schedule.zones.flatMap((z) => z.countries.flatMap((c) => c.cities))[7];
    if (!city) throw new Error('fixture: city 7');
    city.name = { uk: `Змінене місто ${run}` };
    fs.writeFileSync(path.join(tmp, 'schedule.json'), JSON.stringify(schedule));

    const result = await importFrom(tmp);
    expect(result.published).toBe(true);
    const after = await state();
    expect(after.catalogVersion).not.toBe(before.catalogVersion);
    expect(after.catalogVersion).toBe(await seasonVersion());
    expect(after.version).toBeGreaterThan(before.version);
  });
});
