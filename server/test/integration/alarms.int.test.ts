/**
 * Stored alarms (AC-37 … AC-39): a `page` alarm is saved and logged, a failing store never makes
 * `raise` throw (SPEC-02 AC-56), repeats of one kind are throttled, the test door raises one, and
 * the owner's acknowledgement sets `acknowledgedAt` with one journal row.
 */
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { alarmStoreOf, buildDispatcher, payloadOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { createAlarm } from '../../src/platform/logger';
import { post, testDeps } from './helpers';
import { makeAdmin, personMark, removeAdmins, rest, sessionCookie } from './payload-rest';

const OWNER = 'alarms-owner@example.com';
const PASSWORD = 'alarms-password-00000001';

function captureLog() {
  const lines: Record<string, unknown>[] = [];
  const push = (f: Record<string, unknown>) => void lines.push(f);
  return { lines, log: { info: push, warn: push, error: push } };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('stored alarms (AC-37 … AC-39)', () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  const run = `${Date.now()}`;

  const alarmsWith = async (code: string) =>
    (await payload.find({ collection: 'alarms', where: { code: { equals: code } }, overrideAccess: true, depth: 0 })).docs;

  async function until<T>(fn: () => Promise<T[]>, n: number, ms = 3_000): Promise<T[]> {
    const end = Date.now() + ms;
    let found = await fn();
    while (found.length < n && Date.now() < end) {
      await sleep(50);
      found = await fn();
    }
    return found;
  }

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    await removeAdmins(payload, [OWNER]);
  });

  it('AC-37: raise(page) → one stored row and one log line; a repeat inside the window is throttled', async () => {
    const code = `page-${run}`;
    const { lines, log } = captureLog();
    let t = 1_000;
    const alarm = createAlarm(log, alarmStoreOf(deps), { now: () => t });
    alarm.raise({ level: 'page', source: 'test', code });
    alarm.raise({ level: 'page', source: 'test', code });
    const rows = await until(() => alarmsWith(code), 1);
    await sleep(300);
    expect(await alarmsWith(code)).toHaveLength(1);
    expect(rows[0]).toMatchObject({ source: 'test', code, level: 'page' });
    expect(rows[0]?.raisedAt).toBeTruthy();
    expect(rows[0]?.acknowledgedAt ?? null).toBeNull();
    expect(lines).toEqual([{ level: 'alarm', alarm: 'page', source: 'test', code }]);

    t += 60_000;
    alarm.raise({ level: 'page', source: 'test', code });
    expect(await until(() => alarmsWith(code), 2)).toHaveLength(2);
    expect(lines.at(-1)).toMatchObject({ code, suppressed: 1 });
  });

  it('AC-37: a store that throws or rejects → raise returns normally and writes a log-level line', async () => {
    const { lines, log } = captureLog();
    const sync = createAlarm(log, {
      save: () => {
        throw new Error('store down');
      },
    });
    expect(() => sync.raise({ level: 'page', source: 'test', code: 'sync-fail' })).not.toThrow();
    const rejecting = createAlarm(log, { save: () => Promise.reject(new Error('store down')) });
    expect(() => rejecting.raise({ level: 'page', source: 'test', code: 'async-fail' })).not.toThrow();
    await sleep(20);
    expect(lines.filter((l) => l.alarm === 'page')).toHaveLength(2);
    expect(lines).toContainEqual({ level: 'alarm', alarm: 'log', source: 'alarms', code: 'alarm_store_failed' });
  });

  it('AC-39: the door raises a page alarm and answers its id', async () => {
    const code = `door-${run}`;
    const dispatch = await buildDispatcher(deps);
    const res = await dispatch(post('/api/_test/alarm', { source: 'door', code }));
    expect(res.status).toBe(200);
    const { value } = (await res.json()) as { value: { id: string } };
    const [row] = await alarmsWith(code);
    expect(String(row?.id)).toBe(value.id);
    expect((await alarmStoreOf(deps).listOpenPage()).map((a) => a.id)).toContain(value.id);
  });

  it('AC-38: the owner acknowledges → acknowledgedAt set and exactly one journal row', async () => {
    const { id } = await alarmStoreOf(deps).save({ source: 'test', code: `ack-${run}` });
    const journal = async () =>
      (
        await payload.find({
          collection: 'audit-log',
          where: { and: [{ 'target.collection': { equals: 'alarms' } }, { 'target.ref': { equals: id } }, { action: { equals: 'collection.update' } }] },
          overrideAccess: true,
          depth: 0,
        })
      ).docs;

    expect((await rest('POST', `/alarms/${id}/acknowledge`, { headers: personMark() })).status).toBe(403);
    expect((await rest('POST', `/alarms/${id}/acknowledge`, { headers: owner })).status).toBe(200);
    const doc = await payload.findByID({ collection: 'alarms', id: Number(id), overrideAccess: true, depth: 0 });
    expect(doc.acknowledgedAt).toBeTruthy();
    const rows = await journal();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor: { kind: 'owner' } });

    expect((await rest('POST', `/alarms/${id}/acknowledge`, { headers: owner })).status).toBe(200);
    expect(await journal()).toHaveLength(1);
    expect((await alarmStoreOf(deps).listOpenPage()).map((a) => a.id)).not.toContain(id);
    expect((await rest('POST', '/alarms/999999999/acknowledge', { headers: owner })).status).toBe(404);
  });
});
