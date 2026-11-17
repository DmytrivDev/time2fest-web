/**
 * Catalog version bump (AC-67, AC-20, W28): renaming a city sets a new `generatedAt` on the season,
 * publishes one `catalog.changed` event with the new version and writes one journal row for the city.
 * An import-context write does none of it.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, payloadOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { createTinyCatalog, IMPORT_CONTEXT, removeTinyCatalog, type TinyCatalog } from './catalog-helpers';
import { testDeps } from './helpers';

const run = `cv${Date.now()}`;

describe('catalog version (AC-67)', () => {
  let deps: Deps;
  let payload: Payload;
  let tiny: TinyCatalog;

  const latest = () => eventsOf(deps).log.latest('catalog.changed');
  const cityRows = async () =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { 'target.collection': { equals: 'cities' }, 'target.ref': { equals: String(tiny.ids.cities) } },
        overrideAccess: true,
        pagination: false,
        depth: 0,
      })
    ).totalDocs;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    tiny = await createTinyCatalog(payload, run);
  });

  afterAll(async () => {
    await removeTinyCatalog(payload, run);
  });

  it('renaming a city: new generatedAt, one catalog.changed with the new version, one journal row of the city', async () => {
    const eventBefore = await latest();
    const rowsBefore = await cityRows();
    await payload.update({ collection: 'cities', id: tiny.ids.cities, data: { name: { uk: 'Нова назва' } } });
    const season = await payload.findByID({ collection: 'seasons', id: tiny.ids.seasons, overrideAccess: true, depth: 0 });
    expect(season.generatedAt).not.toBe('2020-01-01T00:00:00Z');
    const version = `${season.generatedAt}+2026f`;
    const eventAfter = await latest();
    expect(eventAfter?.version).toBe((eventBefore?.version ?? 0) + 1);
    expect(eventAfter?.payload).toEqual({ version, at: season.generatedAt });
    expect((await cityRows()) - rowsBefore).toBe(1);
  });

  it('a write in the import context changes nothing of the version', async () => {
    const before = await latest();
    const seasonBefore = await payload.findByID({ collection: 'seasons', id: tiny.ids.seasons, overrideAccess: true, depth: 0 });
    await payload.update({ collection: 'cities', id: tiny.ids.cities, data: { name: { uk: 'Імпорт' } }, context: IMPORT_CONTEXT });
    const seasonAfter = await payload.findByID({ collection: 'seasons', id: tiny.ids.seasons, overrideAccess: true, depth: 0 });
    expect(seasonAfter.generatedAt).toBe(seasonBefore.generatedAt);
    expect((await latest())?.version).toBe(before?.version);
  });
});
