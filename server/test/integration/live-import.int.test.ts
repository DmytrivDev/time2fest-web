/**
 * `import chains` and the stream-sources seed row (SPEC-12 AC-9, AC-68, AC-69, AC-70; W37) on the worktree's test
 * database. The rows of `data/streams.json` are emptied first (rows of other suites have run ids of their own and stay).
 * - AC-68: a dry run, on an empty and on a filled database, writes nothing (rows, journal, outbox, live version).
 * - AC-69: `--apply` twice → the second report is 0 added / 0 changed; a source edited by the owner (`adminEditedAt`)
 *   or with an `override` is skipped and keeps its values; the owner's edit is made with the store call the live
 *   actions use (`editSource`).
 * - AC-70: the seed row gives the stored rows of `import chains --apply` on an empty database; a second seed keeps counts.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { payloadOf, seedStoreOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { liveOf } from '../../src/endpoints/deps';
import { chainsFromData } from '../../src/live/import';
import { importRegistry } from '../../src/registries/imports';
import { runSeed } from '../../src/seed/index';
import { seedRegistry } from '../../src/seed/registry';
import { IMPORT_CONTEXT } from './catalog-helpers';
import { testDeps } from './helpers';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const raw = JSON.parse(fs.readFileSync(path.join(dataDir, 'streams.json'), 'utf8')) as unknown;
const FILE = chainsFromData(raw);
const IDS = FILE.map((s) => s.sourceId);
const row = importRegistry.find((r) => r.key === 'chains');
const seedRow = seedRegistry.filter((r) => r.key === 'live-1-stream-sources');

type Doc = Record<string, unknown>;

describe('import chains', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;

  const readSource = (file: string): unknown => JSON.parse(fs.readFileSync(path.join(dataDir, file), 'utf8'));
  const run = (apply: boolean) => {
    if (!row) throw new Error('registry: no chains row');
    return row.run({ apply, deps, readSource });
  };
  const wipe = async () => {
    await payload.delete({
      collection: 'stream-sources',
      where: { sourceId: { in: IDS } },
      overrideAccess: true,
      context: { ...IMPORT_CONTEXT, t2fInternal: true },
    });
  };
  const count = async (collection: string, where?: object) =>
    (await payload.count({ collection: collection as never, overrideAccess: true, ...(where ? { where: where as never } : {}) })).totalDocs;
  const counts = async () => ({
    sources: await count('stream-sources', { sourceId: { in: IDS } }),
    journal: await count('audit-log'),
    outbox: await count('internal-events'),
    version: (await liveOf(deps).store.state()).version,
  });
  /** The stored rows of the file's sources without ids and timestamps. */
  const snapshot = async (): Promise<Doc[]> => {
    const docs = (await payload.find({ collection: 'stream-sources', where: { sourceId: { in: IDS } }, sort: 'sourceId', pagination: false, overrideAccess: true, depth: 0 })).docs as unknown as Doc[];
    return docs.map((d) => Object.fromEntries(Object.entries(d).filter(([k]) => !['id', 'createdAt', 'updatedAt'].includes(k))));
  };
  const one = async (sourceId: string) =>
    (await payload.find({ collection: 'stream-sources', where: { sourceId: { equals: sourceId } }, overrideAccess: true, depth: 0, limit: 1 })).docs[0] as unknown as Doc;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await wipe();
  }, 300_000);

  afterAll(async () => {
    await wipe();
  }, 300_000);

  it('the registry has the chains row, sorted after catalog', () => {
    expect(importRegistry.map((r) => r.key)).toEqual(expect.arrayContaining(['catalog', 'chains']));
    expect(importRegistry.findIndex((r) => r.key === 'chains')).toBeGreaterThan(importRegistry.findIndex((r) => r.key === 'catalog'));
    expect(row).toBeDefined();
  });

  it('AC-68: a dry run on an empty database reports every source as added and writes nothing', async () => {
    const before = await counts();
    const result = await run(false);
    expect(result.code).toBe(0);
    expect(result.lines[0]).toMatch(/^dry run/);
    expect(result.lines).toContain(`add: ${IDS.length}`);
    expect(await counts()).toEqual(before);
    expect(before.sources).toBe(0);
  });

  it('AC-69: --apply adds every source with one version bump and one live.changed; the second run reports 0 added and 0 changed', async () => {
    const before = await counts();
    const first = await run(true);
    expect(first.code).toBe(0);
    expect(first.lines).toContain(`add: ${IDS.length}`);
    const after = await counts();
    expect(after.sources).toBe(IDS.length);
    expect(after.version).toBe(before.version + 1);
    expect(after.outbox).toBe(before.outbox + 1);
    expect(after.journal).toBe(before.journal + 1);

    const state = await snapshot();
    const second = await run(true);
    expect(second.lines).toEqual(expect.arrayContaining(['add: 0', 'change: 0', `same: ${IDS.length}`]));
    expect(await counts()).toEqual(after);
    expect(await snapshot()).toEqual(state);
  });

  it('AC-68: a dry run on a filled database writes nothing', async () => {
    const before = await counts();
    const result = await run(false);
    expect(result.lines).toEqual(expect.arrayContaining(['add: 0', 'change: 0']));
    expect(await counts()).toEqual(before);
  });

  it('AC-9, AC-69: a source edited by the owner, one with an override and a changed static field', async () => {
    const [edited, overridden, drifted] = IDS;
    const live = liveOf(deps).store;
    await live.inTransaction(null, async (tx) => {
      await live.editSource(tx, edited!, { order: 77, adminEditedAt: Date.now() });
      await live.editSource(tx, overridden!, { override: 'ended', status: 'possible' });
    });
    await payload.update({ collection: 'stream-sources', where: { sourceId: { equals: drifted! } }, data: { name: 'drifted' }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    // The poller's field of the drifted source stays: only the static fields are imported.
    await payload.update({ collection: 'stream-sources', where: { sourceId: { equals: IDS[3]! } }, data: { status: 'live' }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });

    const editedBefore = await one(edited!);
    const overriddenBefore = await one(overridden!);
    const dry = await run(false);
    expect(dry.lines).toEqual(expect.arrayContaining(['add: 0', 'change: 1', 'skipped (changed in the admin): 2']));

    const applied = await run(true);
    expect(applied.code).toBe(0);
    const pick = (d: Doc) => ({ order: d.order, status: d.status, override: d.override, name: d.name, adminEditedAt: d.adminEditedAt });
    expect(pick(await one(edited!))).toEqual(pick(editedBefore));
    expect(pick(await one(overridden!))).toEqual(pick(overriddenBefore));
    expect((await one(drifted!)).name).toBe(FILE[2]!.name);
    expect((await one(IDS[3]!)).status).toBe('live');

    const again = await run(true);
    expect(again.lines).toEqual(expect.arrayContaining(['add: 0', 'change: 0', 'skipped (changed in the admin): 2']));
  });

  it('AC-70: the seed row gives the rows of an import on an empty database; a second seed keeps the counts', async () => {
    expect(seedRow).toHaveLength(1);
    await wipe();
    await run(true);
    const imported = await snapshot();
    expect(imported).toHaveLength(IDS.length);

    await wipe();
    const store = seedStoreOf(deps);
    const first = await runSeed(store, seedRow);
    const afterFirst = await snapshot();
    const second = await runSeed(store, seedRow);
    expect(second).toEqual(first);
    expect(afterFirst).toEqual(imported);
    expect(await snapshot()).toEqual(imported);
  });
});
