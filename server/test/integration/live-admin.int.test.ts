/**
 * The owner's live-air actions on the worktree's test database (SPEC-12 AC-50, AC-51, AC-53 … AC-56; W32).
 * Requests go straight into Payload's REST handler (`/cms-api/live/*`, root endpoints) with the proxy's identity marker
 * and an admin session, like `site-admin.int.test.ts`; the endpoints and the revert handlers use THE process deps.
 * Sources of this run are rows of their own (`evt_<run>`); `live.changed` is read from the outbox (`EventLog`), and the
 * `live:streams` events it fans out to are derived with the fan-out's own `streamEventsOf`.
 * - AC-51: hide → the source leaves the public chain, `live.changed` carries `hidden` (→ a `hide` event), one journal
 *   row (actor, reason); its revert brings the source back under a new version.
 * - AC-53: main → the source first, one row, revert restores the order; override `live` → `override` set, one row,
 *   revert clears it.
 * - AC-54: zone-live (service, a fixed clock inside the window) → the zone's sources served `live` until the window
 *   end, then the stored status again; the revert restores at once.
 * - AC-55: replace → a `possible` source, one ad-hoc check queued; one poller pass asks the fake YouTube exactly once
 *   for that id and the source enters the chain of a `live.changed`.
 * - AC-56: `content-agent`, `stream-agent`, no login → 403; a 1 025-byte body → 400; state and journal unchanged.
 */
import { LIVE_REASON_MAX, type LiveActionBody } from '@time2fest/contracts';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { getDeps, payloadOf } from '../../src/container';
import { publicChain } from '../../src/domain/live/chain';
import type { LiveEvent } from '../../src/domain/live/moment';
import { windowOf } from '../../src/domain/live/moment';
import { eventsOf, liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import {
  applyLiveAction,
  LIVE_HIDE_ACTION,
  LIVE_MAIN_ACTION,
  LIVE_OVERRIDE_ACTION,
  LIVE_REPLACE_ACTION,
  LIVE_ZONE_LIVE_ACTION,
  type LiveActionsDeps,
} from '../../src/live/actions';
import { streamEventsOf } from '../../src/live/fanout';
import { createLivePoller, LIVE_CHANGED_TOPIC, type LiveChangedPayload } from '../../src/live/poller';
import { liveActionsOf } from '../../src/registries/revertHandlers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'live-admin-owner@example.com';
const CONTENT = 'live-admin-content@example.com';
const STREAM = 'live-admin-stream@example.com';
const PASSWORD = 'live-admin-password-0001'; // check-secrets: allow test fake
const run = `la${Date.now()}`;
const EVENT_ID = `evt_${run}`;
const ZONE = `Test/Zone_${run}`;
const S1 = `src_${run}_1`;
const S2 = `src_${run}_2`;
const S3 = `src_${run}_3`;
const V = { s1: 'zMCea32gpmg', s2: 'MXmzsjABC-U', s3: 'Y6gzQmbSpEg', fresh: 'QI-PPEW2Bgc' };

type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string } };

interface Fake {
  url: string;
  close(): Promise<void>;
}

describe('owner live-air actions', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let fake: Fake;
  let owner: Record<string, string>;
  let content: Record<string, string>;
  let stream: Record<string, string>;
  /** The event of this run; its moment is put "now" (process clock) so its window is open. */
  let event: LiveEvent;

  const json = async (res: Response) => (await res.json()) as Json;
  const call = (action: string, body: unknown, headers = owner) => rest('POST', `/live/${action}`, { headers, body });
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number, action: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, { action: { equals: action } }] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  const revert = async (id: number) => {
    const res = await rest('POST', `/audit-log/${id}/revert`, { headers: owner });
    expect(res.status, await res.clone().text()).toBe(200);
  };
  const sourcesNow = () => live.store.sources({ eventIds: [EVENT_ID] });
  const chainNow = async (now = deps.clock.now()) => publicChain(event, await sourcesNow(), { now, cfg: live.cfg, zoneLive: (await live.store.state()).zoneLive });
  const lastChange = async () => (await eventsOf(deps).log.latest(LIVE_CHANGED_TOPIC))?.payload as LiveChangedPayload | undefined;
  const version = async () => (await live.store.state()).version;

  async function addSource(row: Record<string, unknown>): Promise<void> {
    await payload.create({
      collection: 'stream-sources',
      data: { platform: 'youtube', eventId: EVENT_ID, status: 'live', embeddable: true, privacyStatus: 'public', ...row } as never,
      overrideAccess: true,
    });
  }

  async function clean(): Promise<void> {
    await payload.delete({ collection: 'stream-sources', where: { eventId: { equals: EVENT_ID } }, overrideAccess: true });
    await live.store.claimPendingChecks();
  }

  async function agentHeaders(email: string, role: 'content-agent' | 'stream-agent'): Promise<Record<string, string>> {
    const id = await makeAdmin(payload, email, PASSWORD, role);
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    return { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  }

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    event = { eventId: EVENT_ID, zoneId: ZONE, moment: deps.clock.now(), nonMidnight: false, hidden: false };
    await clean();
    await addSource({ sourceId: S1, videoId: V.s1, order: 0 });
    await addSource({ sourceId: S2, videoId: V.s2, order: 1 });
    await addSource({ sourceId: S3, videoId: V.s3, order: 2, status: 'expected' });
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    content = await agentHeaders(CONTENT, 'content-agent');
    stream = await agentHeaders(STREAM, 'stream-agent');
  });

  afterAll(async () => {
    if (!payload) return;
    await clean();
    const state = await live.store.state();
    if (state.zoneLive[ZONE]) {
      const zoneLive = { ...state.zoneLive };
      delete (zoneLive as Record<string, unknown>)[ZONE];
      await live.store.inTransaction(null, (tx) => live.store.setZoneLive(tx, zoneLive));
    }
    for (const email of [OWNER, CONTENT, STREAM]) await removeAdmins(payload, [email]);
    await fake?.close();
  });

  it('AC-51: hide → out of the chain, a hide event, one journal row; the revert brings it back under a new version', async () => {
    expect((await chainNow())?.sources.map((s) => s.id)).toContain(S2);
    const mark = await maxJournalId();
    const v0 = await version();
    const res = await call('hide', { action: 'hide', eventId: EVENT_ID, sourceId: S2, reason: `Новини змінили тему ${run}` });
    expect(res.status, await res.clone().text()).toBe(200);
    expect((await json(res)).value).toMatchObject({ changed: true });
    const v1 = await version();
    expect(v1).toBeGreaterThan(v0);
    expect((await chainNow())?.sources.map((s) => s.id)).not.toContain(S2);

    const change = await lastChange();
    expect(change).toEqual({ version: v1, eventIds: [EVENT_ID], hidden: [{ eventId: EVENT_ID, sourceId: S2 }] });
    const streamEvents = streamEventsOf(change as LiveChangedPayload, { version: v1, generatedAt: new Date().toISOString(), chains: [] } as never);
    expect(streamEvents).toContainEqual({ type: 'hide', eventId: EVENT_ID, sourceId: S2, version: v1 });

    const rows = await rowsAfter(mark, LIVE_HIDE_ACTION);
    expect(rows).toHaveLength(1);
    const row = rows[0] as Row;
    expect(row.actor).toMatchObject({ kind: 'owner', label: OWNER });
    expect(row.before).toMatchObject({ eventId: EVENT_ID, sourceId: S2, hidden: false });
    expect(row.after).toMatchObject({ hidden: true, reason: `Новини змінили тему ${run}` });
    expect(row.revertible).toBe(true);

    await revert(row.id);
    expect(await version()).toBeGreaterThan(v1);
    expect((await chainNow())?.sources.map((s) => s.id)).toContain(S2);
    const after = await rowsAfter(mark, LIVE_HIDE_ACTION);
    expect(after).toHaveLength(2);
    expect((after[1] as Row).revertOf).toBe(String(row.id));
  });

  it('AC-53: main puts the source first and override sets `override`; each one row, each reverted in one step', async () => {
    const mark = await maxJournalId();
    const main = await call('main', { action: 'main', eventId: EVENT_ID, sourceId: S3, reason: `Краща картинка ${run}` });
    expect(main.status, await main.clone().text()).toBe(200);
    const ordered = (await sourcesNow()).sort((a, b) => a.order - b.order).map((s) => s.sourceId);
    expect(ordered).toEqual([S3, S1, S2]);
    const mainRows = await rowsAfter(mark, LIVE_MAIN_ACTION);
    expect(mainRows).toHaveLength(1);
    await revert((mainRows[0] as Row).id);
    expect((await sourcesNow()).sort((a, b) => a.order - b.order).map((s) => s.sourceId)).toEqual([S1, S2, S3]);

    const ov = await call('override', { action: 'override', eventId: EVENT_ID, sourceId: S3, status: 'live', reason: `Насправді наживо ${run}` });
    expect(ov.status, await ov.clone().text()).toBe(200);
    expect((await sourcesNow()).find((s) => s.sourceId === S3)?.override).toBe('live');
    expect((await chainNow())?.sources.find((s) => s.id === S3)).toMatchObject({ status: 'live', override: true });
    const ovRows = await rowsAfter(mark, LIVE_OVERRIDE_ACTION);
    expect(ovRows).toHaveLength(1);
    expect((ovRows[0] as Row).after).toMatchObject({ override: 'live' });
    await revert((ovRows[0] as Row).id);
    expect((await sourcesNow()).find((s) => s.sourceId === S3)?.override ?? null).toBeNull();

    // [А-R3] override only forces `live`: any other status is refused by the strict body, nothing written.
    const v0 = await version();
    for (const status of ['expected', 'possible', 'ended']) {
      const refused = await call('override', { action: 'override', eventId: EVENT_ID, sourceId: S3, status, reason: 'x' });
      expect(refused.status).toBe(400);
      expect((await json(refused)).error?.code).toBe('validation');
    }
    expect(await version()).toBe(v0);
    expect(await rowsAfter(mark, LIVE_OVERRIDE_ACTION)).toHaveLength(2);
  });

  it('AC-54: zone-live serves the zone live until the window end, then the stored status; the revert restores at once', async () => {
    const T = event.moment + 60_000;
    const end = windowOf(event.moment, live.cfg).to;
    const service: LiveActionsDeps = { ...liveActionsOf(deps), events: { events: async () => [event] }, clock: { now: () => T } };
    const mark = await maxJournalId();
    const s3Before = async (now: number) => (await chainNow(now))?.sources.find((s) => s.id === S3)?.status;
    expect(await s3Before(T)).not.toBe('live');

    const result = await applyLiveAction(service, null, { kind: 'owner', id: 'test', label: OWNER }, { action: 'zone-live', zoneId: ZONE, live: true, reason: `Пояс наживо ${run}` });
    expect(result).toMatchObject({ ok: true, changed: true });
    expect((await live.store.state()).zoneLive[ZONE]).toEqual({ until: end });
    expect(await s3Before(T)).toBe('live');
    // After the window end the stored status serves again (the poller's).
    expect(await s3Before(end)).not.toBe('live');

    const rows = await rowsAfter(mark, LIVE_ZONE_LIVE_ACTION);
    expect(rows).toHaveLength(1);
    expect((rows[0] as Row).after).toMatchObject({ zoneId: ZONE, until: end });
    await revert((rows[0] as Row).id);
    expect((await live.store.state()).zoneLive[ZONE]).toBeUndefined();
    expect(await s3Before(T)).not.toBe('live');

    // Through the endpoint: a zone with no open window is refused, nothing written.
    const none = await call('zone-live', { action: 'zone-live', zoneId: `Nowhere/${run}`, live: true, reason: 'x' });
    expect(none.status).toBe(400);
    expect((await json(none)).error).toEqual({ code: 'validation', reason: 'no-open-window' });
  });

  it('AC-55: replace adds a possible source and one ad-hoc check; the fake is asked once and the source joins the chain', async () => {
    const S4 = `src_${run}_4`;
    await fetch(`${fake.url}/_control/reset`, { method: 'POST', body: '{}', headers: { 'content-type': 'application/json' } });
    await fetch(`${fake.url}/_control/videos`, {
      method: 'POST',
      // Every video of the run is live, so the cycle the first pass runs keeps the other sources as they are.
      body: JSON.stringify({ videos: Object.values(V).map((id) => ({ id, state: 'live' })) }),
      headers: { 'content-type': 'application/json' },
    });
    // SPEC-21a AC-23: a 4th active source would be `chain-full`; S3 is dead, so the new one fits the ceiling.
    await live.store.inTransaction(null, (tx) => live.store.editSource(tx, S3, { dead: true, deadReason: 'ended' }));
    const mark = await maxJournalId();
    const startedAt = performance.now();
    const res = await call('replace', { action: 'replace', eventId: EVENT_ID, sourceId: S4, videoId: V.fresh, reason: `Заміна ${run}` });
    expect(res.status, await res.clone().text()).toBe(200);
    const added = (await sourcesNow()).find((s) => s.sourceId === S4);
    expect(added).toMatchObject({ videoId: V.fresh, status: 'possible', platform: 'youtube' });
    expect((await live.store.state()).pendingChecks.filter((p) => p.sourceId === S4)).toHaveLength(1);
    expect((await rowsAfter(mark, LIVE_REPLACE_ACTION))).toHaveLength(1);

    const changes: LiveChangedPayload[] = [];
    const real = eventsOf(deps).publisher;
    const poller = createLivePoller({
      store: live.store,
      quota: live.quota,
      lease: live.lease,
      statuses: createYoutubeFakeSource(fake.url),
      events: { events: async () => [event] },
      publisher: {
        async publish(tx, topic, body) {
          if (topic === LIVE_CHANGED_TOPIC) changes.push(body as LiveChangedPayload);
          return real.publish(tx, topic, body);
        },
      },
      alarm: { raise: () => undefined },
      cfg: live.cfg,
      caller: live.caller,
    });
    try {
      await poller.tick(deps.clock.now());
    } finally {
      await poller.release();
    }
    const body = (await (await fetch(`${fake.url}/_control/calls`)).json()) as { calls: { path: string; ids: string[] }[] };
    const asked = body.calls.filter((c) => c.path === '/youtube/v3/videos' && c.ids.includes(V.fresh));
    expect(asked).toHaveLength(1);
    expect(performance.now() - startedAt).toBeLessThan(10_000);
    expect(changes.some((c) => c.eventIds.includes(EVENT_ID))).toBe(true);
    expect((await chainNow())?.sources.find((s) => s.id === S4)).toMatchObject({ videoId: V.fresh });

    // A malformed videoId is refused.
    const bad = await call('replace', { action: 'replace', eventId: EVENT_ID, sourceId: S4, videoId: 'not a video', reason: 'x' });
    expect(bad.status).toBe(400);
  });

  it('AC-50: the view lists the slot sources, the actions and three quota buckets', async () => {
    const res = await rest('GET', '/live/view', { headers: owner });
    expect(res.status, await res.clone().text()).toBe(200);
    const value = (await json(res)).value as { actions: string[]; quota: { bucket: string; percent: number; resetAt: string }[] };
    expect(value.actions).toEqual(['hide', 'unhide', 'main', 'override', 'zone-live', 'replace']);
    expect(value.quota.map((q) => q.bucket)).toEqual(['queries', 'search', 'batchGetStats']);
    for (const q of value.quota) expect(q.resetAt).toMatch(/Z$/);
  });

  it('AC-56: agents, no login and a 1 025-byte body are refused; nothing changes', async () => {
    const before = await sourcesNow();
    const v0 = await version();
    const mark = await maxJournalId();
    const hide: LiveActionBody = { action: 'hide', eventId: EVENT_ID, sourceId: S1, reason: 'not mine' };
    for (const headers of [content, stream, {}]) {
      const res = await call('hide', hide, headers);
      expect(res.status).toBe(403);
      expect((await json(res)).error?.code).toBe('forbidden');
      expect((await rest('GET', '/live/view', { headers })).status).toBe(403);
    }
    // A body that is valid but for its size: a long (unknown) source id makes it 1 025 bytes. Read past the limit it
    // would be a 404 `not-found`; refused at the limit it is a 400.
    const base = JSON.stringify({ ...hide, sourceId: '' });
    const big = JSON.stringify({ ...hide, sourceId: 's'.repeat(1025 - Buffer.byteLength(base, 'utf8')) });
    expect(Buffer.byteLength(big, 'utf8')).toBe(1025);
    const res = await call('hide', JSON.parse(big));
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('validation');
    // The reason over 200 characters is refused too (strict schema).
    expect((await call('hide', { ...hide, reason: 'x'.repeat(LIVE_REASON_MAX + 1) })).status).toBe(400);
    expect(await sourcesNow()).toEqual(before);
    expect(await version()).toBe(v0);
    expect(await maxJournalId()).toBe(mark);
  });
});
