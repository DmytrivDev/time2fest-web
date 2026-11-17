/**
 * Unattended mode (AC-20, AC-22, AC-31 … AC-36; W41 … W45) on the worktree's test database:
 * windows through `POST /cms-api/unattended-windows`, the manual switch through
 * `POST /cms-api/globals/unattended-state/manual`, alarms through the alarm store at test-clock
 * instants, transitions through `evaluate` (what the ticker calls) and the ticker itself.
 *
 * Every scenario checks AC-36: exactly one `unattended.changed` event (schema-valid, consecutive
 * versions, also received by the test subscriber) and one journal row per transition.
 *
 * Windows (Kyiv, UTC+2 in March): W1 01.03 00:00–08:00, W2 02.03 00:00–08:00, W3 03.03 00:00–08:00.
 * The scenarios start from the mode off with no open `page` alarm (open ones of earlier files are acknowledged).
 */
import { UnattendedChangedSchema } from '@time2fest/contracts/schemas';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestClock } from '../../src/clock';
import { alarmStoreOf, payloadOf, startBackground, startUnattendedTicker, unattendedDepsOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import type { EventBus } from '../../src/events/bus';
import { recordedEvents } from '../../src/registries/subscribers';
import {
  evaluate,
  readUnattended,
  UNATTENDED_CHANGED_TOPIC,
  UNATTENDED_MANUAL_ACTION,
  UNATTENDED_STATE,
  UNATTENDED_TRANSITION_ACTION,
  UNATTENDED_WINDOWS,
  type UnattendedDeps,
} from '../../src/unattended/service';
import { testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'unattended-owner@example.com';
const PASSWORD = 'unattended-password-0001';
const run = `ua${Date.now()}`;
const S = 1_000;
const MIN = 60_000;
const H = 60 * MIN;
const INTERNAL = { t2fTrusted: true, t2fInternal: true };
const W1 = { s: Date.parse('2027-02-28T22:00:00Z'), e: Date.parse('2027-03-01T06:00:00Z') };
const W2 = { s: Date.parse('2027-03-01T22:00:00Z'), e: Date.parse('2027-03-02T06:00:00Z') };
const W3 = { s: Date.parse('2027-03-02T22:00:00Z'), e: Date.parse('2027-03-03T06:00:00Z') };
const T = Date.parse('2027-03-10T12:00:00Z');

type Row = Record<string, unknown> & { id: number };
type Expected = { on: boolean; cause: 'schedule' | 'manual' | 'alarm'; actor: 'owner' | 'system' };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(predicate: () => boolean | Promise<boolean>, ms: number): Promise<boolean> {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await predicate()) return true;
    await sleep(50);
  }
  return predicate();
}

describe('unattended mode', { timeout: 300_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let ud: UnattendedDeps;
  let bus: EventBus;
  let owner: Record<string, string>;
  const clock = createTestClock();
  const alarmIds: string[] = [];

  const at = (ms: number) => clock.set({ at: ms, frozen: true });
  const tick = (ms: number) => evaluate(ud, null, ms);
  const maxId = async (collection: 'audit-log' | 'internal-events') =>
    Number(((await payload.find({ collection, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const marks = async () => ({ journal: await maxId('audit-log'), events: await maxId('internal-events') });
  const raise = async (code: string) => {
    const { id } = await alarmStoreOf(deps).save({ source: 'unattended-test', code: `${code}-${run}` });
    alarmIds.push(id);
    return id;
  };
  const acknowledge = (id: string) => rest('POST', `/alarms/${id}/acknowledge`, { headers: owner });
  const manual = (on: unknown, headers = owner) => rest('POST', `/globals/${UNATTENDED_STATE}/manual`, { headers, body: { on } });
  const createWindow = (startsAtKyiv: string, endsAtKyiv: string, headers = owner) =>
    rest('POST', `/${UNATTENDED_WINDOWS}`, { headers, body: { startsAtKyiv, endsAtKyiv, label: run } });
  const state = async () => (await readUnattended(ud.store)).state;

  /** AC-36, AC-20: since `base`, exactly the expected transitions — one event and one journal row each. */
  async function expectTransitions(base: { journal: number; events: number }, expected: Expected[]): Promise<void> {
    const events = (
      await payload.find({
        collection: 'internal-events',
        where: { and: [{ id: { greater_than: base.events } }, { topic: { equals: UNATTENDED_CHANGED_TOPIC } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
    const journal = (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: base.journal } }, { action: { in: [UNATTENDED_TRANSITION_ACTION, UNATTENDED_MANUAL_ACTION] } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
    const payloads = events.map((e) => UnattendedChangedSchema.parse(e.payload));
    expect(payloads.map(({ on, cause }) => ({ on, cause }))).toEqual(expected.map(({ on, cause }) => ({ on, cause })));
    for (let i = 1; i < payloads.length; i++) expect(payloads[i]?.version).toBe((payloads[i - 1]?.version ?? 0) + 1);
    expect(journal.map((j) => (j.actor as { kind: string }).kind)).toEqual(expected.map((e) => e.actor));
    expect(journal.every((j) => (j.target as { collection: string }).collection === UNATTENDED_STATE)).toBe(true);
    const ids = new Set(events.map((e) => String(e.id)));
    const received = () => recordedEvents().filter((e) => ids.has(e.id));
    expect(await waitFor(() => received().length === ids.size, 3_000)).toBe(true);
    expect(received().map((e) => e.payload)).toEqual(events.map((e) => e.payload));
  }

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    ud = unattendedDepsOf(deps);
    await payload.delete({ collection: UNATTENDED_WINDOWS, where: { id: { exists: true } }, overrideAccess: true, context: INTERNAL });
    await payload.update({
      collection: 'alarms',
      where: { acknowledgedAt: { exists: false } },
      data: { acknowledgedAt: new Date().toISOString() },
      overrideAccess: true,
      context: INTERNAL,
    });
    const current = await state();
    await payload.updateGlobal({ slug: UNATTENDED_STATE, data: { on: false, cause: null, manualAt: null, version: current.version, changedAt: null }, overrideAccess: true, context: INTERNAL });
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    bus = await startBackground(deps);
  });

  afterAll(async () => {
    await bus?.stop();
    clock.reset();
    await payload.delete({ collection: UNATTENDED_WINDOWS, where: { label: { equals: run } }, overrideAccess: true, context: INTERNAL });
    if (alarmIds.length > 0) {
      await payload.update({
        collection: 'alarms',
        where: { and: [{ id: { in: alarmIds.map(Number) } }, { acknowledgedAt: { exists: false } }] },
        data: { acknowledgedAt: new Date().toISOString() },
        overrideAccess: true,
        context: INTERNAL,
      });
    }
    const current = await state();
    await payload.updateGlobal({ slug: UNATTENDED_STATE, data: { on: false, cause: null, manualAt: null, version: current.version, changedAt: null }, overrideAccess: true, context: INTERNAL });
    await removeAdmins(payload, [OWNER]);
  });

  it('AC-31: Kyiv input stored as UTC; end ≤ start and overlaps refused (400); only the owner', async () => {
    expect((await createWindow('2027-03-01T00:00', '2027-03-01T08:00', personMark())).status).toBe(403);
    const created = await createWindow('2027-03-01T00:00', '2027-03-01T08:00');
    expect(created.status, await created.clone().text()).toBe(201);
    const doc = ((await created.json()) as { doc: Record<string, unknown> }).doc;
    expect(doc.startsAt).toBe(new Date(W1.s).toISOString());
    expect(doc.endsAt).toBe(new Date(W1.e).toISOString());

    const same = await createWindow('2027-03-05T10:00', '2027-03-05T10:00');
    expect(same.status).toBe(400);
    expect(await same.text()).toContain('end-not-after-start');
    const overlap = await createWindow('2027-03-01T07:00', '2027-03-01T09:00');
    expect(overlap.status).toBe(400);
    expect(await overlap.text()).toContain('overlaps');
    expect((await createWindow('2027-03-05T25:00', '2027-03-05T26:00')).status).toBe(400);

    expect((await createWindow('2027-03-02T00:00', '2027-03-02T08:00')).status).toBe(201);
    expect((await createWindow('2027-03-03T00:00', '2027-03-03T08:00')).status).toBe(201);
    const windows = (await readUnattended(ud.store)).windows;
    expect(windows.map((w) => [w.startsAt, w.endsAt])).toEqual([
      [W1.s, W1.e],
      [W2.s, W2.e],
      [W3.s, W3.e],
    ]);
  });

  it('AC-32, AC-36: start −1 s → off, start → on, end → off; the same instant twice → one transition', async () => {
    const base = await marks();
    expect((await tick(W1.s - S)).changed).toBe(false);
    const on = await tick(W1.s);
    expect(on.changed).toBe(true);
    expect(on.state).toMatchObject({ on: true, cause: 'schedule' });
    expect((await tick(W1.s)).changed).toBe(false);
    expect((await tick(W1.e - S)).changed).toBe(false);
    expect((await tick(W1.e)).state).toMatchObject({ on: false, cause: null });
    await expectTransitions(base, [
      { on: true, cause: 'schedule', actor: 'system' },
      { on: false, cause: 'schedule', actor: 'system' },
    ]);
  });

  it('AC-33: a manual off inside a window holds until its end; a manual on outside holds until the next start', async () => {
    const base = await marks();
    await tick(W2.s);
    expect((await manual(true, personMark())).status).toBe(403);
    expect((await manual('yes')).status).toBe(400);

    at(W2.s + H);
    const off = await manual(false);
    expect(off.status, await off.clone().text()).toBe(200);
    expect(await state()).toMatchObject({ on: false, cause: 'manual', manualAt: W2.s + H });
    expect((await tick(W2.s + 2 * H)).changed).toBe(false);
    expect((await tick(W2.e - S)).changed).toBe(false);
    expect((await tick(W2.e)).state).toMatchObject({ on: false, cause: null });

    at(W2.e + H);
    expect((await manual(true)).status).toBe(200);
    expect((await readUnattended(ud.store)).manualUntil).toBe(W3.s);
    expect((await tick(W3.s - S)).changed).toBe(false);
    expect((await tick(W3.s)).state).toMatchObject({ on: true, cause: 'schedule' });
    expect((await tick(W3.e)).state).toMatchObject({ on: false, cause: null });
    await expectTransitions(base, [
      { on: true, cause: 'schedule', actor: 'system' },
      { on: false, cause: 'manual', actor: 'owner' },
      { on: false, cause: 'schedule', actor: 'system' },
      { on: true, cause: 'manual', actor: 'owner' },
      { on: true, cause: 'schedule', actor: 'system' },
      { on: false, cause: 'schedule', actor: 'system' },
    ]);
  });

  it('AC-34: a page alarm at T → T+14:59 off, T+15:00 on with the cause alarm and the actor system', async () => {
    const base = await marks();
    at(T);
    await raise('a1');
    expect((await tick(T + 15 * MIN - S)).changed).toBe(false);
    expect((await tick(T + 15 * MIN)).state).toMatchObject({ on: true, cause: 'alarm' });
    await expectTransitions(base, [{ on: true, cause: 'alarm', actor: 'system' }]);
    const row = (await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as unknown as Row;
    expect(row.actor).toMatchObject({ kind: 'system', label: 'unattended' });
  });

  it('AC-35: +2 h of quiet → still on; acknowledging one of two → on; the last → off', async () => {
    const base = await marks();
    expect((await tick(T + 2 * H + 15 * MIN)).changed).toBe(false);
    at(T + 2 * H + 20 * MIN);
    await raise('a2');
    at(T + 2 * H + 30 * MIN);
    expect((await acknowledge(alarmIds[0] as string)).status).toBe(200);
    expect((await tick(T + 2 * H + 30 * MIN)).changed).toBe(false);
    expect((await acknowledge(alarmIds[1] as string)).status).toBe(200);
    expect((await tick(T + 2 * H + 31 * MIN)).state).toMatchObject({ on: false, cause: null });
    await expectTransitions(base, [{ on: false, cause: 'alarm', actor: 'system' }]);
  });

  it('AC-35: a manual off ends the alarm-caused mode, and the open alarm does not turn it back on', async () => {
    const base = await marks();
    const T2 = T + 5 * H;
    at(T2);
    await raise('a3');
    expect((await tick(T2 + 15 * MIN)).state).toMatchObject({ on: true, cause: 'alarm' });
    at(T2 + 20 * MIN);
    expect((await manual(false)).status).toBe(200);
    expect((await tick(T2 + 3 * H)).changed).toBe(false);
    expect(await state()).toMatchObject({ on: false, cause: 'manual' });
    await expectTransitions(base, [
      { on: true, cause: 'alarm', actor: 'system' },
      { on: false, cause: 'manual', actor: 'owner' },
    ]);
  });

  it('AC-32, AC-34: the ticker applies a due alarm by itself', async () => {
    const base = await marks();
    const T3 = T + 10 * H;
    at(T3);
    await raise('a4');
    at(T3 + 15 * MIN);
    const ticker = startUnattendedTicker(deps, 100);
    try {
      expect(await waitFor(async () => (await state()).on, 5_000)).toBe(true);
    } finally {
      await ticker.stop();
    }
    expect(await state()).toMatchObject({ on: true, cause: 'alarm' });
    for (const id of alarmIds.slice(2)) expect((await acknowledge(id)).status).toBe(200);
    expect((await tick(T3 + 20 * MIN)).state).toMatchObject({ on: false, cause: null });
    await expectTransitions(base, [
      { on: true, cause: 'alarm', actor: 'system' },
      { on: false, cause: 'alarm', actor: 'system' },
    ]);
  });

  it('AC-22: reverting a manual switch restores the mode before it, with a linked journal row and one event', async () => {
    const T4 = T + 20 * H;
    at(T4);
    const base = await marks();
    expect((await manual(true)).status).toBe(200);
    const row = (
      await payload.find({ collection: 'audit-log', where: { action: { equals: UNATTENDED_MANUAL_ACTION } }, sort: '-id', limit: 1, overrideAccess: true, depth: 0 })
    ).docs[0] as unknown as Row;
    expect(row.revertible).toBe(true);
    const reverted = await rest('POST', `/audit-log/${row.id}/revert`, { headers: owner });
    expect(reverted.status, await reverted.clone().text()).toBe(200);
    expect(await state()).toMatchObject({ on: false, cause: null, manualAt: null });
    const last = (await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as unknown as Row;
    expect(last.revertOf).toBe(String(row.id));
    await expectTransitions(base, [
      { on: true, cause: 'manual', actor: 'owner' },
      { on: false, cause: 'manual', actor: 'owner' },
    ]);
  });
});
