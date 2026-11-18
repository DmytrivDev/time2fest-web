/**
 * SPEC-07 clock control and the «стан свята» slice on the worktree's test database (AC-51, AC-53,
 * AC-56, AC-75, AC-77, AC-78, NFR-7; W33, W34, W36, W37). Requests go straight into Payload's REST
 * handler (`/cms-api/...`, the root endpoints of the `test` class) with the proxy's identity marker
 * and an admin session, like `unattended.int.test.ts`; the endpoints use THE process deps.
 * - AC-51, NFR-7: set → restart-night → real by the owner: each changes the stored state and writes
 *   exactly one `clock.change` journal row with the owner as actor.
 * - AC-53: another role, or the owner without the gate's marker → 403, no state change, no row.
 * - AC-75, AC-77: the slice at 23:50 Paris (frozen test clock) for the owner; 403 for another role.
 * - AC-78: a failing lease store → only the `scheduler` block is an error.
 * - AC-56: an anonymous centrifuge-js client on `site:state` receives one `clock` event with the id
 *   `clock:<epoch>:<seq>` of the written state (skipped, with a line naming Centrifugo, when it is down).
 */
import { ClockEventSchema, FestivalStateViewSchema } from '@time2fest/contracts/schemas';
import type { Centrifuge, PublicationContext } from 'centrifuge';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { festivalDepsOf } from '../../src/admin/cmsEndpoints';
import { createTestClock } from '../../src/clock';
import { payloadOf } from '../../src/container';
import type { Deps } from '../../src/endpoints/types';
import { festivalState } from '../../src/scheduler/festival';
import { CLOCK_CHANGE_ACTION } from '../../src/timekeeping/ports';
import { testDeps } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';
import { centrifugeClient, connectAndWait, describeRealtime, name } from './realtime-support';

const OWNER = 'clock-control-owner@example.com';
const AGENT = 'clock-control-agent@example.com';
const PASSWORD = 'clock-control-password-0001'; // check-secrets: allow test fake
/** 23:50 in Paris (UTC+1) on New Year's Eve. */
const PARIS_2350 = Date.parse('2026-12-31T22:50:00Z');
const SET_AT = Date.parse('2026-12-31T22:59:30Z');

type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(pred: () => boolean, ms: number): Promise<boolean> {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    if (pred()) return true;
    await sleep(20);
  }
  return pred();
}

describe('clock control and the festival slice', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  let agent: Record<string, string>;
  const shared = () => deps.sharedClock!;
  const testClock = () => createTestClock(shared());

  const clock = (body: unknown, headers = owner) => rest('POST', '/clock', { headers, body });
  const slice = (headers = owner) => rest('GET', '/festival-state', { headers });
  const json = async (res: Response) => (await res.json()) as Json;
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const clockRows = async (after: number) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, { action: { equals: CLOCK_CHANGE_ACTION } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  const stored = async () => {
    await shared().refresh();
    return shared().state();
  };

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await testClock().reset();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    const agentId = await makeAdmin(payload, AGENT, PASSWORD, 'content-agent');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    // An agent signs in only with its API key, through a service token of the gate (like roles.int.test.ts).
    const issued = await rest('POST', `/admins/${agentId}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    agent = { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  });

  afterAll(async () => {
    if (deps) await testClock().reset();
    if (payload) await removeAdmins(payload, [OWNER, AGENT]);
  });

  it('AC-51, NFR-7: set, restart-night, real — each changes the state, one journal row each with the owner', async () => {
    const mark = await maxJournalId();
    const before = await stored();

    const set = await clock({ action: 'set', at: SET_AT });
    expect(set.status, await set.clone().text()).toBe(200);
    const setValue = (await json(set)).value!;
    expect(setValue).toMatchObject({ speed: 1, virtual: true, epoch: before.runEpoch });
    expect(Math.abs(Number(setValue.now) - SET_AT)).toBeLessThan(5_000);
    expect(await stored()).toMatchObject({ virtual: true, speed: 1, frozen: false, seq: before.seq + 1 });

    const restart = await clock({ action: 'restart-night' });
    expect(restart.status).toBe(200);
    expect((await json(restart)).value).toMatchObject({ epoch: before.runEpoch + 1, virtual: true });
    expect(await stored()).toMatchObject({ runEpoch: before.runEpoch + 1, seq: before.seq + 2 });

    const real = await clock({ action: 'real' });
    expect(real.status).toBe(200);
    expect((await json(real)).value).toMatchObject({ virtual: false, speed: 1, epoch: before.runEpoch + 1 });
    expect(await stored()).toMatchObject({ virtual: false, seq: before.seq + 3 });

    const rows = await clockRows(mark);
    expect(rows).toHaveLength(3);
    for (const row of rows) expect((row.actor as { kind: string }).kind).toBe('owner');
    expect(rows.map((r) => (r.after as { seq: number }).seq)).toEqual([before.seq + 1, before.seq + 2, before.seq + 3]);
  });

  it('AC-53: another role or no gate marker → 403 forbidden; nothing changes, no journal row; speed is not an admin action', async () => {
    const mark = await maxJournalId();
    const before = await stored();
    const noGate = { cookie: owner.cookie ?? '' };
    for (const headers of [agent, noGate]) {
      const res = await clock({ action: 'set', at: SET_AT }, headers);
      expect(res.status).toBe(403);
    }
    expect((await clock({ action: 'speed', speed: 60 })).status).toBe(400);
    expect(await stored()).toEqual(before);
    expect(await clockRows(mark)).toHaveLength(0);
  });

  it('AC-75, AC-77: the slice at 23:50 Paris for the owner; another role gets 403 and no data', async () => {
    await testClock().set({ at: PARIS_2350, frozen: true });
    try {
      const res = await slice();
      expect(res.status, await res.clone().text()).toBe(200);
      const view = FestivalStateViewSchema.parse((await json(res)).value);
      expect(view.errors).toBeUndefined();
      expect(view.phase).toBe('during');
      expect(view.slot.current).toContain('utc+0100');
      expect(view.slot.next).toContain('utc+0000');
      expect(view.moments).toHaveLength(10);
      expect(view.moments.every((m) => m.at > PARIS_2350)).toBe(true);
      expect(view.moments).toContainEqual({ at: Date.parse('2026-12-31T23:00:00Z'), kind: 'zone-midnight', subject: 'utc+0100' });
      expect(view.clock).toMatchObject({ virtual: true, speed: 1, now: PARIS_2350, epoch: shared().state().runEpoch });

      const denied = await slice(agent);
      expect(denied.status).toBe(403);
      expect((await json(denied)).value).toBeUndefined();
    } finally {
      await testClock().reset();
    }
  });

  it('AC-78: a failing lease store → the scheduler block is an error, the other blocks are computed', async () => {
    await testClock().set({ at: PARIS_2350, frozen: true });
    try {
      const real = festivalDepsOf(deps, payloadOf(deps));
      const view = await festivalState({ ...real, lease: { read: () => Promise.reject(new Error('lease store down')) } });
      expect(view.errors).toEqual(['scheduler']);
      expect(view.phase).toBe('during');
      expect(view.moments).toHaveLength(10);
      expect(view.clock.virtual).toBe(true);
    } finally {
      await testClock().reset();
    }
  });
});

describeRealtime('clock event on site:state', () => {
  let deps: Deps;
  let payload: Payload;
  let owner: Record<string, string>;
  const shared = () => deps.sharedClock!;

  beforeAll(async () => {
    deps = testDeps();
    payload = await payloadOf(deps)();
    await createTestClock(shared()).reset();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
  });

  afterAll(async () => {
    if (deps) await createTestClock(shared()).reset();
    if (payload) await removeAdmins(payload, [OWNER]);
  });

  it('AC-56: one owner action → one clock event with the id clock:<epoch>:<seq> of the written state', async () => {
    const client: Centrifuge = centrifugeClient(null);
    const got: unknown[] = [];
    try {
      expect(await connectAndWait(client)).toBe('connected');
      const sub = client.newSubscription(name('site:state'));
      sub.on('publication', (ctx: PublicationContext) => got.push(ctx.data));
      const subscribed = new Promise<void>((resolve) => sub.once('subscribed', () => resolve()));
      sub.subscribe();
      await subscribed;

      const res = await rest('POST', '/clock', { headers: owner, body: { action: 'set', at: SET_AT } });
      expect(res.status).toBe(200);
      await shared().refresh();
      const state = shared().state();
      const id = `clock:${state.runEpoch}:${state.seq}`;
      const clockEvents = () => got.filter((d) => (d as { type?: unknown }).type === 'clock');
      expect(await waitFor(() => clockEvents().length > 0, 3_000)).toBe(true);
      await sleep(500);
      expect(clockEvents()).toHaveLength(1);
      expect(ClockEventSchema.parse(clockEvents()[0])).toEqual({ type: 'clock', id, data: { virtual: true, speed: 1 } });
    } finally {
      client.disconnect();
    }
  });
});
