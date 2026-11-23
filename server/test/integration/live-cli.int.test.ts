/**
 * The operator command `live hide` (SPEC-12 AC-52, [А16]; W32) run as a real process (`tsx src/cli/live.ts`, class
 * `test`) against the worktree's test database.
 * - The command hides the source: it leaves the public chain, the outbox holds one `live.changed` with `hidden` (the
 *   fan-out sends it as a `hide` event) within 1 s of the command's commit, and one journal row names the actor
 *   «оператор» with the reason. The owner's revert through `/cms-api/audit-log/:id/revert` brings the source back.
 * - Without `--reason`, or for an unknown source, the command exits ≠ 0 with one line and writes nothing.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDeps, payloadOf } from '../../src/container';
import { publicChain } from '../../src/domain/live/chain';
import type { LiveEvent } from '../../src/domain/live/moment';
import { eventsOf, liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { LIVE_HIDE_ACTION } from '../../src/live/actions';
import { LIVE_CHANGED_TOPIC, type LiveChangedPayload } from '../../src/live/poller';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const tsx = path.join(serverDir, 'node_modules', 'tsx', 'dist', 'cli.mjs');
const OWNER = 'live-cli-owner@example.com';
const PASSWORD = 'live-cli-password-0001'; // check-secrets: allow test fake
const run = `lc${Date.now()}`;
const EVENT_ID = `evt_${run}`;
const S1 = `src_${run}_1`;
const S2 = `src_${run}_2`;

type Row = Record<string, unknown> & { id: number };

function cli(args: string[]) {
  const out = spawnSync(process.execPath, [tsx, 'src/cli/live.ts', ...args], {
    cwd: serverDir,
    env: { ...process.env, T2F_ENV: 'test' },
    encoding: 'utf8',
    timeout: 90_000,
  });
  return { status: out.status, stdout: out.stdout.trim(), stderr: out.stderr.trim() };
}

describe('operator command live hide', { timeout: 180_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let event: LiveEvent;
  let owner: Record<string, string>;

  const sourcesNow = () => live.store.sources({ eventIds: [EVENT_ID] });
  const chainIds = async () =>
    (publicChain(event, await sourcesNow(), { now: deps.clock.now(), cfg: live.cfg, zoneLive: (await live.store.state()).zoneLive })?.sources ?? []).map((s) => s.id);
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const hideRowsAfter = async (after: number) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, { action: { equals: LIVE_HIDE_ACTION } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    event = { eventId: EVENT_ID, zoneId: 'Europe/London', moment: deps.clock.now(), nonMidnight: false, hidden: false };
    for (const [sourceId, videoId, order] of [
      [S1, 'zMCea32gpmg', 0],
      [S2, 'MXmzsjABC-U', 1],
    ] as const) {
      await payload.create({
        collection: 'stream-sources',
        data: { platform: 'youtube', eventId: EVENT_ID, sourceId, videoId, order, status: 'live', embeddable: true, privacyStatus: 'public' } as never,
        overrideAccess: true,
      });
    }
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    if (!payload) return;
    await payload.delete({ collection: 'stream-sources', where: { eventId: { equals: EVENT_ID } }, overrideAccess: true });
    await removeAdmins(payload, [OWNER]);
  });

  it('no reason, an empty reason or an unknown source → exit ≠ 0, one line, nothing written', async () => {
    const mark = await maxJournalId();
    const version = (await live.store.state()).version;
    for (const args of [
      ['hide', EVENT_ID, S1],
      ['hide', EVENT_ID, S1, '--reason'],
      ['hide', EVENT_ID, `src_${run}_unknown`, '--reason', 'Новини'],
    ]) {
      const out = cli(args);
      expect(out.status, out.stderr).not.toBe(0);
      expect(out.stderr.split('\n').filter(Boolean)).toHaveLength(1);
    }
    expect(await maxJournalId()).toBe(mark);
    expect((await live.store.state()).version).toBe(version);
    expect(await chainIds()).toContain(S1);
  });

  it('AC-52: the command hides the source with actor «оператор»; the owner reverts it from the journal', async () => {
    const mark = await maxJournalId();
    const reason = `Новинний ефір змінив тему ${run}`;
    const out = cli(['hide', EVENT_ID, S2, '--reason', ...reason.split(' ')]);
    const doneAt = performance.now();
    expect(out.status, out.stderr).toBe(0);
    const printed = JSON.parse(out.stdout.split('\n').pop() ?? '{}') as { ok: boolean; version: number; changed: boolean };
    expect(printed).toMatchObject({ ok: true, changed: true });

    const latest = await eventsOf(deps).log.latest(LIVE_CHANGED_TOPIC);
    expect(performance.now() - doneAt).toBeLessThan(1_000);
    expect(latest?.payload as LiveChangedPayload).toEqual({ version: printed.version, eventIds: [EVENT_ID], hidden: [{ eventId: EVENT_ID, sourceId: S2 }] });
    expect(await chainIds()).not.toContain(S2);

    const rows = await hideRowsAfter(mark);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Row;
    expect(row.actor).toMatchObject({ label: 'оператор' });
    expect(row.after).toMatchObject({ hidden: true, reason });
    expect(row.revertible).toBe(true);

    const reverted = await rest('POST', `/audit-log/${row.id}/revert`, { headers: owner });
    expect(reverted.status, await reverted.clone().text()).toBe(200);
    expect(await chainIds()).toContain(S2);
    expect((await live.store.state()).version).toBeGreaterThan(printed.version);
  });
});
