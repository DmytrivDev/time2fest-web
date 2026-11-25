/**
 * `import catalog` (AC-67, AC-75 to AC-79, AC-81, NFR-4) against the `_test` database. The catalog tables
 * are emptied first (the door of this suite), then the real `data/` files are imported.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eventsOf, payloadOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { IMPORT_CONTEXT, KINDS } from './catalog-helpers';
import { testDeps } from './helpers';
import { listKeys, r2Env } from './r2-helpers';
import { NON_TEST_GOOGLE } from '../support/nonTestGoogle';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dataDir = path.join(serverDir, '../data');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const row = importRegistry.find((r) => r.key === 'catalog');

type City = { name: { uk: string } };
type Schedule = { zones: { id: string; countries: { cities: City[] }[] }[] };
const tmpDirs: string[] = [];
function copyOfData(edit?: (schedule: Schedule) => void): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-import-'));
  tmpDirs.push(dir);
  fs.copyFileSync(path.join(dataDir, 'countries.json'), path.join(dir, 'countries.json'));
  const schedule = JSON.parse(fs.readFileSync(path.join(dataDir, 'schedule.json'), 'utf8'));
  edit?.(schedule);
  fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify(schedule));
  return dir;
}

describe('import catalog', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;

  const reader = (dir: string) => (file: string) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
  const run = (apply: boolean, dir = dataDir) => {
    if (!row) throw new Error('registry: no catalog row');
    return row.run({ apply, deps, readSource: reader(dir) });
  };
  const count = async (collection: string) =>
    (await payload.count({ collection: collection as never, overrideAccess: true })).totalDocs;
  const counts = async () => ({
    ...Object.fromEntries(await Promise.all([...KINDS, 'audit-log', 'internal-events'].map(async (k) => [k, await count(k)]))),
  });
  const snapshot = async () => {
    const out: Record<string, unknown[]> = {};
    for (const kind of KINDS) {
      const docs = (await payload.find({ collection: kind, overrideAccess: true, pagination: false, depth: 0, sort: 'id' })).docs;
      out[kind] = docs.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => k !== 'createdAt' && k !== 'updatedAt')));
    }
    return out;
  };
  const wipe = async () => {
    for (const kind of [...KINDS].reverse()) {
      await payload.delete({ collection: kind, where: { id: { exists: true } }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    }
  };
  const latestVersion = async () => (await eventsOf(deps).log.latest('catalog.changed'))?.version ?? 0;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await wipe();
  }, 300_000);

  afterAll(async () => {
    await wipe();
    for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
  }, 300_000);

  it('AC-75: a dry run writes nothing and reports the four groups', async () => {
    const r2 = r2Env();
    const before = await counts();
    const r2Before = await listKeys(r2, r2.prefix);
    const result = await run(false);
    expect(result.code).toBe(0);
    expect(await counts()).toEqual(before);
    expect(await listKeys(r2, r2.prefix)).toEqual(r2Before);
    const text = result.lines.join('\n');
    for (const group of ['add:', 'change:', 'same:', 'skipped (changed in the admin):']) expect(text).toContain(group);
    expect(result.plan?.counts.add).toBe(1616);
  });

  it('AC-76, AC-67, NFR-4: two applies leave the same state; the second reports 0 / 0 and publishes nothing', async () => {
    const t0 = Date.now();
    const first = await run(true);
    const applyMs = Date.now() - t0;
    expect(first.code, first.lines.slice(0, 3).join('\n')).toBe(0);
    expect(first.plan?.counts.add).toBe(1616);
    expect(first.published).toBe(true);
    const afterFirst = await snapshot();
    const version = await latestVersion();
    const t1 = Date.now();
    const dry = await run(false);
    const dryMs = Date.now() - t1;
    console.log(`NFR-4: apply ${applyMs} ms, dry run ${dryMs} ms`);
    expect(applyMs).toBeLessThanOrEqual(120_000);
    expect(dryMs).toBeLessThanOrEqual(60_000);
    expect(dry.plan?.counts).toEqual({ add: 0, change: 0, same: 1616, 'skipped-admin-edited': 0 });

    const second = await run(true);
    expect(second.plan?.counts.add).toBe(0);
    expect(second.plan?.counts.change).toBe(0);
    expect(second.published).toBe(false);
    expect(await snapshot()).toEqual(afterFirst);
    expect(await latestVersion()).toBe(version);
  });

  it('AC-77: a city renamed in the admin keeps its name and is reported as skipped', async () => {
    const city = (await payload.find({ collection: 'cities', where: { cityId: { equals: 'auckland' } }, overrideAccess: true, depth: 0 })).docs[0];
    if (!city) throw new Error('fixture: auckland');
    await payload.update({ collection: 'cities', id: city.id, data: { name: { uk: 'Назва з адмінки' } } });
    const result = await run(true);
    expect(result.plan?.entries.find((e) => e.row.key === 'auckland')?.group).toBe('skipped-admin-edited');
    expect(result.lines.join('\n')).toContain('cities/auckland');
    const after = await payload.findByID({ collection: 'cities', id: city.id, overrideAccess: true, depth: 0 });
    expect((after.name as { uk?: string }).uk).toBe('Назва з адмінки');
  });

  it('AC-78: two changed records give one summary row and two record rows', async () => {
    const dir = copyOfData((s) => {
      const cities = s.zones.flatMap((z) => z.countries.flatMap((c) => c.cities));
      (cities[40] as City).name = { uk: 'Змінене місто 40' };
      (cities[41] as City).name = { uk: 'Змінене місто 41' };
    });
    const before = await count('audit-log');
    const result = await run(true, dir);
    expect(result.plan?.counts.change).toBe(2);
    expect((await count('audit-log')) - before).toBe(3);
    const rows = (
      await payload.find({ collection: 'audit-log', sort: '-id', limit: 3, overrideAccess: true, depth: 0 })
    ).docs as unknown as { action: string; actor: { kind: string; ref: string }; target: { collection: string } }[];
    expect(rows.filter((r) => r.action === 'catalog.import')).toHaveLength(1);
    expect(rows.filter((r) => r.target.collection === 'cities')).toHaveLength(2);
    for (const r of rows) expect(r.actor).toMatchObject({ kind: 'system', ref: 'import' });
  });

  it('AC-81: a source that fails its schema stops the import: file and path named, database unchanged', async () => {
    const dir = copyOfData((s) => {
      (s.zones[3] as Schedule["zones"][number]).id = '';
    });
    const before = await counts();
    const result = await run(true, dir);
    expect(result.code).toBe(1);
    const text = result.lines.join('\n');
    expect(text).toContain('schedule.json');
    expect(text).toContain('zones.3.id');
    expect(await counts()).toEqual(before);
  });

  it('AC-79: the CLI dry-runs in the rehearsal class without test doors', () => {
    // The local env file minus the doors switch, so the process has no `T2F_TEST_DOORS` at all.
    const local: Record<string, string> = {};
    for (const line of fs.readFileSync(path.join(serverDir, '.env.local'), 'utf8').split(/\r?\n/)) {
      const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
      if (m?.[1] && m[2] !== undefined && m[1] !== 'T2F_TEST_DOORS') local[m[1]] = m[2];
    }
    const env: NodeJS.ProcessEnv = {
      ...local,
      ...process.env,
      ...NON_TEST_GOOGLE,
      T2F_ENV: 'rehearsal',
      T2F_ADMIN_HOST: 'admin.example.com',
      T2F_ACCESS_TEAM_DOMAIN: 'https://t2f.example.com',
      T2F_ACCESS_AUD: 'aud-tag',
      T2F_ACCESS_JWKS_URL: 'https://t2f.example.com/cdn-cgi/access/certs',
      T2F_OWNER_EMAILS: 'main@example.com',
      T2F_R2_ENDPOINT: 'https://r2.example.com',
      T2F_R2_BUCKET: 'bucket',
      T2F_R2_PREFIX: 'rehearsal/',
      T2F_R2_ACCESS_KEY_ID: 'key-id',
      T2F_R2_SECRET_ACCESS_KEY: 'key-secret',
      // Required in rehearsal since SPEC-05 (edge gate); built at runtime, never a literal.
      T2F_EDGE_SECRET: randomBytes(24).toString('hex'),
    };
    delete env.T2F_TEST_DOORS;
    const r = spawnSync(process.execPath, [tsx, 'src/cli/import.ts', 'catalog', '--source-dir', dataDir], {
      cwd: serverDir,
      env,
      encoding: 'utf8',
      timeout: 120_000,
    });
    expect(`${r.stderr}`.slice(0, 300)).not.toContain('invalid');
    expect(r.status, `${r.stderr}`.slice(0, 500)).toBe(0);
    expect(r.stdout).toContain('dry run');
  });
});
