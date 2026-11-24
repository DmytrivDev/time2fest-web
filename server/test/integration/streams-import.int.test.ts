/**
 * `import channels` (SPEC-21a AC-1 import half, AC-40, AC-41, AC-42) on the worktree's test database.
 * The two stream collections are emptied before and after.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createPayloadStreamsStore } from '../../src/adapters/payloadStreams';
import { payloadOf } from '../../src/container';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps } from '../../src/endpoints/types';
import { importRegistry } from '../../src/registries/imports';
import { IMPORT_CONTEXT } from './catalog-helpers';
import { testDeps } from './helpers';

const dataDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data');
const real = JSON.parse(fs.readFileSync(path.join(dataDir, 'stream-channels.json'), 'utf8')) as {
  channels: { channelId: string; name: string; kind: string; zones: string[]; priority: number }[];
};
const FIRST = real.channels[0]!;
const BL_ID = 'UCblacklistedchannel0001';
const row = importRegistry.find((r) => r.key === 'channels');

type Doc = Record<string, unknown>;

describe('import channels', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let fake: { url: string; close(): Promise<void> };

  const fileWith = (blacklist: { channelId: string; reason: string }[]) => (name: string): unknown => {
    const base = JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8')) as Record<string, unknown>;
    return { ...base, blacklist };
  };
  const run = (apply: boolean, blacklist: { channelId: string; reason: string }[] = []) => {
    if (!row) throw new Error('registry: no channels row');
    return row.run({ apply, deps, readSource: fileWith(blacklist) });
  };
  const wipe = async () => {
    for (const collection of ['stream-channels', 'stream-candidates'] as const) {
      await payload.delete({ collection, where: { id: { exists: true } }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    }
  };
  const count = async (collection: string, where?: object) =>
    (await payload.count({ collection: collection as never, overrideAccess: true, ...(where ? { where: where as never } : {}) })).totalDocs;
  const journalRows = () => count('audit-log', { action: { equals: 'streams.channels-import' } });
  const one = async (channelId: string) =>
    (await payload.find({ collection: 'stream-channels', where: { channelId: { equals: channelId } }, overrideAccess: true, depth: 0, limit: 1 })).docs[0] as unknown as Doc;

  beforeAll(async () => {
    fake = (await startFakeYoutube({ port: 0 })) as typeof fake;
    deps = testDeps({}, { T2F_YOUTUBE_BASE_URL: fake.url });
    payload = await payloadOf(deps)();
  }, 300_000);
  beforeEach(wipe, 300_000);
  afterAll(async () => {
    await wipe();
    await fake.close();
  }, 300_000);

  it('a dry run on an empty and on a filled database writes no rows and no journal row', async () => {
    const journal = await journalRows();
    const empty = await run(false);
    expect(empty.code).toBe(0);
    expect(empty.lines[0]).toBe('dry run: nothing is written');
    expect(await count('stream-channels')).toBe(0);
    expect(await journalRows()).toBe(journal);

    expect((await run(true)).code).toBe(0);
    const filled = await count('stream-channels');
    const journalAfter = await journalRows();
    expect((await run(false, [{ channelId: BL_ID, reason: 'test' }])).code).toBe(0);
    expect(await count('stream-channels')).toBe(filled);
    expect(await journalRows()).toBe(journalAfter);
  });

  it('applies the file once, keeps every AC-1 field readable, and records one journal row and no YouTube call', async () => {
    const journal = await journalRows();
    const result = await run(true);
    expect(result.code).toBe(0);
    expect(await count('stream-channels')).toBe(real.channels.length);
    expect(await journalRows()).toBe(journal + 1);
    const doc = await one(FIRST.channelId);
    expect(doc).toMatchObject({ channelId: FIRST.channelId, name: FIRST.name, kind: FIRST.kind, zones: FIRST.zones, seasons: ['2026-27'], priority: FIRST.priority, state: 'watched', blacklisted: false });
    expect(doc.uploadsPlaylistId ?? null).toBeNull();
    expect(doc.adminEditedAt ?? null).toBeNull();
    const calls = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { counts: Record<string, number> };
    expect(Object.values(calls.counts).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it('a second apply adds and changes nothing and writes no journal row', async () => {
    await run(true);
    const journal = await journalRows();
    const again = await run(true);
    expect(again.code).toBe(0);
    expect(again.lines).toEqual(expect.arrayContaining(['add: 0', 'change: 0', `same: ${real.channels.length}`]));
    expect(await journalRows()).toBe(journal);
  });

  it('a channel edited in the admin and an admin-added blacklist entry survive the next apply', async () => {
    await run(true);
    const store = createPayloadStreamsStore({ payload: payloadOf(deps), clock: deps.clock });
    const live = liveOf(deps).store;
    await live.inTransaction(null, async (tx) => {
      await store.markChannelAdminEdited(tx, FIRST.channelId, deps.clock.now());
    });
    await payload.update({ collection: 'stream-channels', where: { channelId: { equals: FIRST.channelId } }, data: { name: 'Edited by the owner' }, overrideAccess: true, context: { ...IMPORT_CONTEXT, t2fInternal: true } });
    await live.inTransaction(null, async (tx) => {
      await store.addBlacklisted(tx, BL_ID, 'owner decided', 'admin');
    });

    const result = await run(true, [{ channelId: BL_ID, reason: 'file reason' }]);
    expect(result.code).toBe(0);
    expect(result.lines).toEqual(expect.arrayContaining(['skipped (changed in the admin): 1', 'blacklist kept-admin: 1']));
    expect((await one(FIRST.channelId)).name).toBe('Edited by the owner');
    const bl = await one(BL_ID);
    expect(bl).toMatchObject({ blacklisted: true, blacklistReason: 'owner decided', blacklistSource: 'admin' });

    // An import without that entry never unsets it.
    await run(true);
    expect((await one(BL_ID)).blacklisted).toBe(true);
  });

  it('a blacklist entry of the file is added once', async () => {
    const entry = [{ channelId: BL_ID, reason: 'file reason' }];
    const first = await run(true, entry);
    expect(first.lines).toContain('blacklist add: 1');
    expect(await one(BL_ID)).toMatchObject({ blacklisted: true, blacklistSource: 'import', state: 'off' });
    const second = await run(true, entry);
    expect(second.lines).toEqual(expect.arrayContaining(['blacklist add: 0', 'blacklist same: 1']));
  });
});
