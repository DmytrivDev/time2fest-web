import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { assembleCatalog } from '../../src/domain/catalog/assemble';
import { fromData, rowHash, type CatalogCollection } from '../../src/domain/catalog/fromData';
import { emptyDbRows, planImport, type DbRows } from '../../src/domain/catalog/importPlan';
import { pickDomain } from '../../src/cli/import';
import { importRegistry } from '../../src/registries/imports';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const read = (name: string) => JSON.parse(readFileSync(path.join(serverDir, '../data', name), 'utf8'));
const source = fromData(read('schedule.json'), read('countries.json'));

/** The database as a finished import leaves it: every source row, hash stored. */
function importedDb(): DbRows {
  const db = emptyDbRows();
  source.rows.forEach((row, i) => db[row.collection].set(row.key, { id: String(i + 1), importedHash: row.hash, data: { ...row.data } }));
  return db;
}

describe('fromData', () => {
  it('maps the data files to one row per record', () => {
    const counts: Record<string, number> = {};
    for (const r of source.rows) counts[r.collection] = (counts[r.collection] ?? 0) + 1;
    expect(counts).toEqual({ zones: 38, countries: 246, cities: 298, events: 298, traditions: 738 });
    expect(new Set(source.rows.map((r) => `${r.collection}/${r.key}`)).size).toBe(source.rows.length);
  });

  it('hashes ignore empty values and key order', () => {
    expect(rowHash('cities', { cityId: 'a', name: { uk: 'A', en: null }, landmark: { uk: '' } })).toBe(
      rowHash('cities', { name: { en: '', uk: 'A' }, cityId: 'a' }),
    );
  });

  it('assembling the mapped rows gives the data files back (round trip)', () => {
    const rows = {
      season: source.season,
      ...Object.fromEntries(
        (['zones', 'countries', 'cities', 'events', 'traditions'] as CatalogCollection[]).map((c) => [
          c,
          source.rows.filter((r) => r.collection === c).map((r) => r.data),
        ]),
      ),
    } as Parameters<typeof assembleCatalog>[0];
    const out = assembleCatalog(rows);
    expect(JSON.stringify(out.schedule)).toBe(JSON.stringify(read('schedule.json')));
    expect(JSON.stringify(out.countries)).toBe(JSON.stringify(read('countries.json')));
  });
});

describe('planImport groups (AC-75, AC-77)', () => {
  it('an empty database: everything is added', () => {
    const plan = planImport(source.rows, emptyDbRows());
    expect(plan.counts).toEqual({ add: source.rows.length, change: 0, same: 0, 'skipped-admin-edited': 0 });
  });

  it('a finished import: everything is the same', () => {
    expect(planImport(source.rows, importedDb()).counts).toEqual({ add: 0, change: 0, same: source.rows.length, 'skipped-admin-edited': 0 });
  });

  it('a changed source row is `change`; a row edited in the admin is skipped', () => {
    const db = importedDb();
    const city = source.rows.find((r) => r.collection === 'cities');
    const other = source.rows.filter((r) => r.collection === 'cities')[1];
    if (!city || !other) throw new Error('fixture');
    // The source moved on for `city`: its stored hash is the old one and its fields still match it.
    db.cities.set(city.key, { id: '1', importedHash: rowHash('cities', { ...city.data, name: { uk: 'Стара' } }), data: { ...city.data, name: { uk: 'Стара' } } });
    // `other` was renamed in the admin: its fields no longer match the hash kept at import.
    db.cities.set(other.key, { id: '2', importedHash: other.hash, data: { ...other.data, name: { uk: 'Адмінка' } } });
    const plan = planImport(source.rows, db);
    expect(plan.entries.find((e) => e.row.key === city.key)?.group).toBe('change');
    expect(plan.entries.find((e) => e.row.key === other.key)?.group).toBe('skipped-admin-edited');
    expect(plan.counts.change).toBe(1);
    expect(plan.counts['skipped-admin-edited']).toBe(1);
  });

  it('a stored row without a hash that equals the source is `same`, hash to be filled in', () => {
    const db = importedDb();
    const zone = source.rows[0];
    if (!zone) throw new Error('fixture');
    db.zones.set(zone.key, { id: '1', importedHash: null, data: { ...zone.data } });
    const entry = planImport(source.rows, db).entries[0];
    expect(entry?.group).toBe('same');
    expect(entry?.backfillHash).toBe(true);
  });
});

describe('import domains (AC-80)', () => {
  it('the registry has `catalog`', () => {
    expect(importRegistry.map((r) => r.key)).toContain('catalog');
  });

  it('an unknown domain is refused and the known ones are listed', () => {
    const picked = pickDomain('nope', importRegistry);
    expect(picked.ok).toBe(false);
    expect(picked.ok ? '' : picked.message).toContain('catalog');
  });

  it('`import nope` exits with a code other than 0 and names `catalog`', () => {
    const run = spawnSync(process.execPath, [path.join(serverDir, 'node_modules/tsx/dist/cli.mjs'), 'src/cli/import.ts', 'nope'], {
      cwd: serverDir,
      encoding: 'utf8',
      timeout: 60_000,
    });
    expect(run.status).not.toBe(0);
    expect(`${run.stdout}${run.stderr}`).toContain('catalog');
  }, 90_000);
});
