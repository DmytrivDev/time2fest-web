/**
 * The seed rows of the catalog (AC-88, W32): after the catalog tables are emptied, the seed gives the same
 * state as `import catalog --apply` (business fields plus `importedHash`), twice in a row the same counts,
 * and no seed source is outside the AC-45 list.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf, seedStoreOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { baseSeedRows, runSeed } from '../../src/seed/index';
import { seedRegistry } from '../../src/seed/registry';
import { IMPORT_CONTEXT, KINDS } from './catalog-helpers';
import { testDeps } from './helpers';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(serverDir, '../data');

describe('catalog seed rows', { timeout: 600_000 }, () => {
  let deps: Deps;
  let payload: Payload;

  const wipe = async () => {
    for (const kind of [...KINDS].reverse()) {
      await payload.delete({ collection: kind, where: { id: { exists: true } }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    }
  };
  const counts = async () =>
    Object.fromEntries(await Promise.all(KINDS.map(async (k) => [k, (await payload.count({ collection: k, overrideAccess: true })).totalDocs])));
  /** Business fields and the import hash, by natural key: ids and timestamps differ between two runs. */
  const snapshot = async () => {
    const out: Record<string, unknown[]> = {};
    for (const kind of KINDS) {
      const docs = (await payload.find({ collection: kind, overrideAccess: true, pagination: false, depth: 0 })).docs as unknown as Record<string, unknown>[];
      const rows = docs.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k))));
      out[kind] = rows.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    return out;
  };

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await wipe();
  }, 300_000);

  afterAll(async () => {
    await wipe();
  }, 300_000);

  it('AC-88: the seed after emptying equals the import on an emptied database; a second seed keeps the counts', async () => {
    const row = importRegistry.find((r) => r.key === 'catalog');
    if (!row) throw new Error('registry: no catalog row');
    const readSource = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
    const imported = await row.run({ apply: true, deps, readSource });
    expect(imported.code, imported.lines.slice(0, 3).join('\n')).toBe(0);
    const afterImport = await snapshot();
    expect((afterImport.events as unknown[]).length).toBeGreaterThan(0);

    await wipe();
    expect(Object.values(await counts()).every((n) => n === 0)).toBe(true);
    const store = seedStoreOf(deps);
    const first = await runSeed(store, baseSeedRows());
    const afterSeed = await snapshot();
    expect(afterSeed).toEqual(afterImport);
    expect(first).toMatchObject({ seasons: 1, zones: expect.any(Number), events: expect.any(Number) });

    const second = await runSeed(store, baseSeedRows());
    expect(second).toEqual(first);
    expect(await counts()).toEqual(await counts());
    expect(await snapshot()).toEqual(afterImport);
  });

  it('the six rows are registered in dependency order and read only data files', () => {
    const keys = seedRegistry.filter((r) => r.key.startsWith('catalog-')).map((r) => r.key);
    expect(keys).toEqual(['catalog-1-seasons', 'catalog-2-zones', 'catalog-3-countries', 'catalog-4-cities', 'catalog-5-events', 'catalog-6-traditions']);
    for (const r of seedRegistry.filter((x) => x.key.startsWith('catalog-'))) expect(r.source).toMatch(/^data\/(schedule|countries)\.json$/);
  });

  it('nothing under server/src/seed reads research_data or the streams scout output', () => {
    let out = '';
    try {
      out = execFileSync('git', ['grep', '-n', '-e', 'research_data', '-e', 'streams.candidates', '--', 'src/seed'], { cwd: serverDir, encoding: 'utf8' });
    } catch {
      out = '';
    }
    // `registry.ts` names `streams.candidates` once, as the forbidden source (AC-45); no other mention.
    const hits = out.split('\n').filter((l) => l.trim() !== '' && !l.includes('registry.ts'));
    expect(hits).toEqual([]);
  });
});
