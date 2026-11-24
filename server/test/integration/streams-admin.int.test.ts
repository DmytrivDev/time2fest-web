/**
 * The owner's stream sources endpoints `/cms-api/streams/*` on the worktree's test database (SPEC-21a W29).
 * Requests go straight into Payload's REST handler with the proxy's identity marker and an admin session, like
 * `live-admin.int.test.ts`; the endpoints use THE process deps. The process has no YouTube base URL in the test class,
 * so this file points the process live wiring at the fake YouTube (port 0) for its run and restores it afterwards.
 * Ids are synthetic per run (`<R>v000001`, `UC<R>…`); every row of the run is removed afterwards.
 * - AC-21: `content-agent`, `stream-agent`, no login → 403 on the view and every action; a 1 025-byte body → 400
 *   `invalid`; state and journal unchanged.
 * - AC-22: `GET`/`POST /cms-api/stream-channels|stream-candidates` from the owner and an agent → 403; GraphQL refused;
 *   both collections `admin.hidden` in the config.
 * - AC-1: a channel added through `channel-add` reads back through `view` with every field.
 * - AC-2: blacklist → revert → blacklist: three journal rows, the state after each.
 * - AC-4: an approved candidate of a channel now blacklisted carries the marker in the view.
 * - NFR-6: one journal row per action (channel-add, channel-edit, unblacklist, channel-approve, candidate-add, reject,
 *   requeue).
 */
import config from '@payload-config';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { getDeps, payloadOf } from '../../src/container';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { STREAMS_BLACKLIST_ACTION, STREAMS_CANDIDATE_ACTION, STREAMS_CHANNEL_ACTION } from '../../src/live/sources';
import { sourcesOf } from '../../src/registries/revertHandlers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'streams-admin-owner@example.com';
const CONTENT = 'streams-admin-content@example.com';
const STREAM = 'streams-admin-stream@example.com';
const PASSWORD = 'streams-admin-password-0001'; // check-secrets: allow test fake
const R = Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
const vid = (n: number) => `${R}v${String(n).padStart(6, '0')}`;
const chid = (n: number) => `UC${R}${String(n).padStart(18, '0')}`;
const CH = chid(1);
const CH_PROPOSED = chid(2);
const ACTIONS = ['channel-add', 'channel-edit', 'blacklist', 'unblacklist', 'channel-approve', 'candidate-add', 'approve', 'reject', 'requeue'] as const;

type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string } };
type ViewChannel = Record<string, unknown> & { channelId: string };
type ViewCandidate = Record<string, unknown> & { videoId: string };
interface Fake {
  url: string;
  close(): Promise<void>;
}

describe('owner stream sources endpoints', { timeout: 120_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let fake: Fake;
  let savedStatuses: LiveWiring['statuses'];
  let owner: Record<string, string>;
  let content: Record<string, string>;
  let stream: Record<string, string>;
  const videoIds = new Set<string>();

  const json = async (res: Response) => (await res.json()) as Json;
  const call = (action: string, body: unknown, headers = owner) => rest('POST', `/streams/${action}`, { headers, body });
  const control = async (path: string, body: unknown) => {
    const res = await fetch(`${fake.url}/_control/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
  };
  const view = async (query = '') => {
    const res = await rest('GET', `/streams/view${query}`, { headers: owner });
    expect(res.status, await res.clone().text()).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    return (await json(res)).value as { channels: ViewChannel[]; candidates: ViewCandidate[]; quota: { cls: string }[]; events: unknown[] };
  };
  const channelOf = async (channelId: string) => (await view()).channels.find((c) => c.channelId === channelId);
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number, action?: string) =>
    (
      await payload.find({
        collection: 'audit-log',
        where: { and: [{ id: { greater_than: after } }, ...(action ? [{ action: { equals: action } }] : [])] },
        sort: 'id',
        pagination: false,
        overrideAccess: true,
        depth: 0,
      })
    ).docs as unknown as Row[];
  /** Runs one action as the owner and asserts it wrote exactly one journal row, of `journal`. */
  async function once(action: string, body: Record<string, unknown>, journal: string): Promise<Json> {
    const mark = await maxJournalId();
    const res = await call(action, { action, ...body });
    expect(res.status, await res.clone().text()).toBe(200);
    const rows = await rowsAfter(mark);
    expect(rows.map((r) => r.action)).toEqual([journal]);
    expect(rows[0]?.actor).toMatchObject({ kind: 'owner', label: OWNER });
    return json(res);
  }

  async function agentHeaders(email: string, role: 'content-agent' | 'stream-agent'): Promise<Record<string, string>> {
    const id = await makeAdmin(payload, email, PASSWORD, role);
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    return { ...apiKeyHeader(((await issued.json()) as { key: string }).key), ...serviceMark() };
  }

  async function clean(): Promise<void> {
    const ids = [...videoIds];
    if (ids.length) await payload.delete({ collection: 'stream-candidates' as never, where: { videoId: { in: ids } }, overrideAccess: true });
    await payload.delete({ collection: 'stream-channels' as never, where: { channelId: { like: `UC${R}` } }, overrideAccess: true });
  }

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    savedStatuses = live.statuses;
    (live as { statuses?: LiveWiring['statuses'] }).statuses = createYoutubeFakeSource(fake.url) as LiveWiring['statuses'];
    await clean();
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    content = await agentHeaders(CONTENT, 'content-agent');
    stream = await agentHeaders(STREAM, 'stream-agent');
  });

  afterAll(async () => {
    if (live) (live as { statuses?: LiveWiring['statuses'] }).statuses = savedStatuses;
    if (!payload) return;
    await clean();
    await removeAdmins(payload, [OWNER, CONTENT, STREAM]);
    await fake?.close();
  });

  it('AC-1: a channel added through channel-add reads back through the view with every field', async () => {
    await control('channels', { channels: [{ id: CH, videos: [] }] });
    const added = await once('channel-add', { channelId: CH, name: `Канал ${R}`, kind: 'celebration', zones: ['utc+0100'], priority: 2 }, STREAMS_CHANNEL_ACTION);
    expect(added.value).toMatchObject({ channelId: CH, state: 'watched', created: true });
    const c = await channelOf(CH);
    expect(c).toEqual({
      channelId: CH,
      name: `Канал ${R}`,
      kind: 'celebration',
      zones: ['utc+0100'],
      seasons: [],
      priority: 2,
      state: 'watched',
      blacklisted: false,
      blacklistReason: null,
      blacklistSource: null,
      proposedBy: null,
      uploadsPlaylistId: `UU${CH.slice(2)}`,
      uploadsFetchedAt: expect.any(String),
      lastPlaylistAt: expect.any(String),
      lastSearchAt: null,
    });
    const v = await view();
    expect(v.quota.map((q) => q.cls)).toEqual(['candidates', 'playlists', 'search']);
    expect(Array.isArray(v.events)).toBe(true);
  });

  it('AC-21: agents and no login → 403 on the view and every action; a 1 025-byte body → 400 invalid; nothing changes', async () => {
    const before = await channelOf(CH);
    const mark = await maxJournalId();
    const body = { action: 'blacklist', channelId: CH, reason: 'спроба' };
    for (const headers of [content, stream, personMark(), {}]) {
      const res = await rest('GET', '/streams/view', { headers });
      expect(res.status).toBe(403);
      expect((await json(res)).error?.code).toBe('forbidden');
      for (const action of ACTIONS) {
        const r = await call(action, { ...body, action }, headers);
        expect(r.status, `${action}`).toBe(403);
      }
    }
    const big = { ...body, reason: 'x'.repeat(1025 - JSON.stringify({ ...body, reason: '' }).length) };
    expect(Buffer.byteLength(JSON.stringify(big))).toBe(1025);
    const res = await call('blacklist', big);
    expect(res.status).toBe(400);
    expect((await json(res)).error?.code).toBe('invalid');
    const mismatch = await call('unblacklist', body);
    expect(mismatch.status).toBe(400);
    expect(await channelOf(CH)).toEqual(before);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('AC-22: the collections are hidden and refused directly, even to the owner; GraphQL is refused', async () => {
    const cfg = await config;
    for (const slug of ['stream-channels', 'stream-candidates']) {
      expect(cfg.collections.find((c) => c.slug === slug)?.admin?.hidden).toBe(true);
      for (const headers of [owner, stream]) {
        expect((await rest('GET', `/${slug}`, { headers })).status).toBe(403);
        expect((await rest('POST', `/${slug}`, { headers, body: { channelId: chid(9), videoId: vid(9) } })).status).toBe(403);
      }
    }
    const gql = await rest('POST', '/graphql', { headers: owner, body: { query: '{ StreamChannels { docs { channelId } } }' } });
    expect(gql.status).toBeGreaterThanOrEqual(400);
    expect(await gql.text()).not.toContain(CH);
  });

  it('AC-2: blacklist → revert → blacklist: three journal rows and the state after each', async () => {
    const mark = await maxJournalId();
    await once('blacklist', { channelId: CH, reason: `Чужий контент ${R}` }, STREAMS_BLACKLIST_ACTION);
    expect(await channelOf(CH)).toMatchObject({ blacklisted: true, blacklistReason: `Чужий контент ${R}` });
    const [first] = await rowsAfter(mark, STREAMS_BLACKLIST_ACTION);
    const reverted = await rest('POST', `/audit-log/${(first as Row).id}/revert`, { headers: owner });
    expect(reverted.status, await reverted.clone().text()).toBe(200);
    expect(await channelOf(CH)).toMatchObject({ blacklisted: false });
    await once('blacklist', { channelId: CH, reason: `Знову ${R}` }, STREAMS_BLACKLIST_ACTION);
    expect(await channelOf(CH)).toMatchObject({ blacklisted: true, blacklistReason: `Знову ${R}` });
    expect(await rowsAfter(mark, STREAMS_BLACKLIST_ACTION)).toHaveLength(3);
  });

  it('AC-4: an approved candidate of the now blacklisted channel carries the marker in the view', async () => {
    const sources = await sourcesOf(deps);
    const id = vid(1);
    videoIds.add(id);
    await live.store.inTransaction(null, (tx) => sources.streams.saveCandidate(tx, { videoId: id, channelId: CH, foundBy: ['owner'], state: 'approved' }, 'test', deps.clock.now()));
    const c = (await view('?state=approved')).candidates.find((x) => x.videoId === id);
    expect(c).toMatchObject({ videoId: id, state: 'approved', channelName: `Канал ${R}`, fromBlacklisted: true });
  });

  it('NFR-6: one journal row per action (unblacklist, edit, approve a proposed channel, add, reject, requeue)', async () => {
    await once('unblacklist', { channelId: CH, reason: `Помилка ${R}` }, STREAMS_BLACKLIST_ACTION);
    await once('channel-edit', { channelId: CH, priority: 1, state: 'off' }, STREAMS_CHANNEL_ACTION);
    expect(await channelOf(CH)).toMatchObject({ priority: 1, state: 'off', blacklisted: false });

    const sources = await sourcesOf(deps);
    await live.store.inTransaction(null, (tx) => sources.streams.saveChannel(tx, { channelId: CH_PROPOSED, name: `Пропозиція ${R}`, kind: 'tv', zones: [], seasons: [], priority: 3, state: 'proposed' }));
    await once('channel-approve', { channelId: CH_PROPOSED }, STREAMS_CHANNEL_ACTION);
    expect(await channelOf(CH_PROPOSED)).toMatchObject({ state: 'watched' });
    const again = await call('channel-approve', { action: 'channel-approve', channelId: CH_PROPOSED });
    expect(again.status).toBe(409);
    expect((await json(again)).error?.code).toBe('invalid-state');

    const id = vid(2);
    videoIds.add(id);
    await control('videos', { videos: [{ id, state: 'upcoming', embeddable: true }] });
    const added = await once('candidate-add', { videoId: id }, STREAMS_CANDIDATE_ACTION);
    expect(added.value).toMatchObject({ videoId: id, created: true });
    await once('reject', { videoId: id, reason: `Не те ${R}` }, STREAMS_CANDIDATE_ACTION);
    expect((await view('?state=rejected')).candidates.find((c) => c.videoId === id)).toMatchObject({ state: 'rejected', reason: 'owner' });
    await once('requeue', { videoId: id }, STREAMS_CANDIDATE_ACTION);
    expect((await view('?state=new')).candidates.find((c) => c.videoId === id)).toMatchObject({ state: 'new' });

    const missing = await call('requeue', { action: 'requeue', videoId: vid(3) });
    expect(missing.status).toBe(404);
    const badQuery = await rest('GET', '/streams/view?state=nope', { headers: owner });
    expect(badQuery.status).toBe(400);
  });

  it('agent key section: the view lists the stream-agent record with key status and issue time, never the key; revoke clears it', async () => {
    type AgentKeyRow = { adminId: string; email: string; active: boolean; issuedAt: string | null };
    const keysOf = async () => {
      const res = await rest('GET', '/streams/view', { headers: owner });
      const text = await res.text();
      return { text, keys: ((JSON.parse(text) as Json).value?.agentKeys ?? []) as AgentKeyRow[] };
    };
    const id = String((await payload.find({ collection: 'admins', where: { email: { equals: STREAM } }, overrideAccess: true, depth: 0 })).docs[0]?.id);
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    const key = ((await issued.json()) as { key: string }).key;
    stream = { ...apiKeyHeader(key), ...serviceMark() };
    const after = await keysOf();
    expect(after.keys.find((k) => k.adminId === id)).toMatchObject({ email: STREAM, active: true });
    expect(Date.parse(after.keys.find((k) => k.adminId === id)?.issuedAt ?? '')).toBeGreaterThan(Date.now() - 60_000);
    expect(after.keys.some((k) => k.email === CONTENT || k.email === OWNER)).toBe(false);
    expect(after.text).not.toContain(key);
    expect(after.text).not.toMatch(/apiKey|apiKeyIndex|enableAPIKey/);

    expect((await rest('POST', `/admins/${id}/revoke-key`, { headers: owner })).status).toBe(200);
    expect((await keysOf()).keys.find((k) => k.adminId === id)).toMatchObject({ active: false, issuedAt: null });
    expect((await rest('GET', '/streams/view', { headers: stream })).status).toBe(403);
  });
});
