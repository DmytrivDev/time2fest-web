import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { CATALOG_REASONS } from '../src/catalog';
import { CatalogChangedSchema, CatalogPayloadSchema, UnattendedChangedSchema } from '../src/catalog.schemas';
import { CatalogResponseSchema } from '../src/schemas';

const read = (name: string) => JSON.parse(readFileSync(new URL(`../../../data/${name}`, import.meta.url), 'utf8'));
const schedule = read('schedule.json');
const countries = read('countries.json');
const wrap = (s: unknown) => ({
  ok: true,
  value: { version: `${schedule.generatedAt}+${schedule.tzdbVersion}`, schedule: s, countries },
});

describe('catalog contract', () => {
  it('has the one reason', () => {
    expect([...CATALOG_REASONS]).toEqual(['catalog-invalid']);
  });

  it('data/schedule.json + countries.json wrapped in the result pass', () => {
    expect(CatalogResponseSchema.safeParse(wrap(schedule)).success).toBe(true);
  });

  it('a zone without its id fails with the path', () => {
    const broken = structuredClone(schedule);
    delete broken.zones[3].id;
    expect(CatalogResponseSchema.safeParse(wrap(broken)).success).toBe(false);
    const r = CatalogPayloadSchema.safeParse(wrap(broken).value);
    const paths = r.success ? [] : r.error.issues.map((i) => i.path.join('.'));
    expect(paths).toContain('schedule.zones.3.id');
  });

  it('an unknown key is refused', () => {
    expect(CatalogResponseSchema.safeParse(wrap({ ...schedule, extra: 1 })).success).toBe(false);
  });

  it('event payloads', () => {
    expect(CatalogChangedSchema.safeParse({ version: 'v', at: 'a' }).success).toBe(true);
    expect(CatalogChangedSchema.safeParse({ version: 'v' }).success).toBe(false);
    expect(UnattendedChangedSchema.safeParse({ on: true, cause: 'alarm', at: 'a', version: 1 }).success).toBe(true);
    expect(UnattendedChangedSchema.safeParse({ on: true, cause: 'x', at: 'a', version: 1 }).success).toBe(false);
  });
});
