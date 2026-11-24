/**
 * The stream agent's surface `/cms-api/stream-agent/*` on the worktree's test database (SPEC-21a W34). Requests go
 * straight into Payload's REST handler with the service identity marker and an issued `stream-agent` key, like
 * `streams-admin.int.test.ts`; the endpoints use THE process deps, pointed at the fake YouTube (port 0) for this run.
 * Ids are synthetic per run; every row of the run is removed afterwards.
 * - AC-33: each of the three addresses works and matches its contract; 1 025-byte body and an extra field → `invalid`.
 * - AC-31: 10 proposals → `proposed`, journal actor `agent`; the live version and `GET /api/live/chains` unchanged.
 * - AC-32: approve, reject, channel edit, blacklist (every owner action), every `/cms-api/live/*` address, direct
 *   writes into the collections → 403; nothing changes.
 * - AC-3: the agent proposes a video of a blacklisted channel → `rejected/blacklisted`.
 * - AC-37: the 31st proposal and the 61st read in a minute, and the 301st proposal of the quota day → 429.
 * - AC-38: propose → revoke → the next proposal and read are refused.
 * - NFR-3 / NFR-6: the key never appears in responses, the journal, the outbox or the log; the log has no videoId.
 */
import { sql } from '@payloadcms/db-postgres';
import { LIVE_ACTIONS, STREAMS_ACTIONS } from '@time2fest/contracts';
import { AgentCandidatesResponseSchema, AgentChannelsResponseSchema, AgentProposeResultSchema } from '@time2fest/contracts/schemas';
import type { Payload } from 'payload';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startFakeYoutube } from '../../../fakes/youtube/server.mjs';
import { createYoutubeFakeSource } from '../../src/adapters/youtubeFake';
import { buildDispatcher, getDeps, payloadOf } from '../../src/container';
import { nextDayBoundary, quotaDay, type QuotaCounterKey } from '../../src/domain/live/quota';
import { liveOf } from '../../src/endpoints/deps';
import type { Deps, LiveWiring } from '../../src/endpoints/types';
import { STREAMS_CANDIDATE_ACTION } from '../../src/live/sources';
import { createTinyCatalog, removeTinyCatalog } from './catalog-helpers';
import { BASE } from './helpers';
import { apiKeyHeader, makeAdmin, personMark, removeAdmins, rest, serviceMark, sessionCookie } from './payload-rest';

const OWNER = 'streams-agent-owner@example.com';
const AGENT = 'streams-agent-main@example.com';
const LIMITS = 'streams-agent-limits@example.com';
const DAILY = 'streams-agent-daily@example.com';
const PASSWORD = 'streams-agent-password-0001'; // check-secrets: allow test fake
const R = Math.random().toString(36).slice(2, 6).padEnd(4, 'x');
const RUN = `sa${R}`;
const vid = (n: number) => `${R}a${String(n).padStart(6, '0')}`;
const chid = (n: number) => `UC${R}${String(n).padStart(18, '0')}`;
const BLACK = chid(1);

type Row = Record<string, unknown> & { id: number };
type Json = { ok: boolean; value?: Record<string, unknown>; error?: { code: string; reason?: string; retryAfterMs?: number } };
interface Fake {
  url: string;
  close(): Promise<void>;
}
type Exec = { execute(q: unknown): Promise<{ rows: Record<string, unknown>[] }> };

describe('stream agent surface', { timeout: 180_000 }, () => {
  let deps: Deps;
  let payload: Payload;
  let live: LiveWiring;
  let fake: Fake;
  let savedStatuses: LiveWiring['statuses'];
  let dispatch: (r: Request) => Promise<Response>;
  let owner: Record<string, string>;
  let agent: Record<string, string>;
  let limits: Record<string, string>;
  let daily: Record<string, string>;
  let agentId = 0;
  let dailyId = 0;
  let limitsId = 0;
  let key = '';
  let eventId = '';
  let tinyMade = false;
  let journalStart = 0;
  const videoIds = new Set<string>();
  const bodies: string[] = [];
  const logged: string[] = [];
  const restoreLog: (() => void)[] = [];

  const db = () => (payload.db as unknown as { drizzle: Exec }).drizzle;
  const json = async (res: Response) => {
    const text = await res.text();
    bodies.push(text);
    return JSON.parse(text) as Json;
  };
  const control = async (path: string, body: unknown) => {
    const res = await fetch(`${fake.url}/_control/${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    expect(res.status).toBe(200);
  };
  const upcoming = (ids: string[]) => {
    for (const id of ids) videoIds.add(id);
    return control('videos', { videos: ids.map((id) => ({ id, state: 'upcoming', embeddable: true })) });
  };
  const propose = (body: unknown, headers = agent) => rest('POST', '/stream-agent/candidates', { headers, body });
  const maxJournalId = async () =>
    Number(((await payload.find({ collection: 'audit-log', sort: '-id', limit: 1, overrideAccess: true, depth: 0 })).docs[0] as Row | undefined)?.id ?? 0);
  const rowsAfter = async (after: number) =>
    (await payload.find({ collection: 'audit-log', where: { id: { greater_than: after } }, sort: 'id', pagination: false, overrideAccess: true, depth: 0 })).docs as unknown as Row[];
  const candidateRows = async () => (await db().execute(sql`SELECT "video_id", "state", "reason" FROM "stream_candidates" WHERE "video_id" LIKE ${`${R}a%`} ORDER BY "video_id"`)).rows;
  const channelRows = async () => (await db().execute(sql`SELECT * FROM "stream_channels" WHERE "channel_id" LIKE ${`UC${R}%`} ORDER BY "channel_id"`)).rows;
  const chains = async () => {
    const res = await dispatch(new Request(`${BASE}/api/live/chains`, { headers: { accept: 'application/json' } }));
    expect(res.status).toBe(200);
    return res.text();
  };

  async function issue(email: string): Promise<{ id: number; key: string }> {
    const id = await makeAdmin(payload, email, PASSWORD, 'stream-agent');
    const issued = await rest('POST', `/admins/${id}/issue-key`, { headers: owner });
    expect(issued.status).toBe(200);
    return { id, key: ((await issued.json()) as { key: string }).key };
  }

  async function clean(): Promise<void> {
    await db().execute(sql`DELETE FROM "stream_candidates" WHERE "video_id" LIKE ${`${R}a%`}`);
    await db().execute(sql`DELETE FROM "stream_channels" WHERE "channel_id" LIKE ${`UC${R}%`}`);
  }

  beforeAll(async () => {
    deps = getDeps();
    expect(deps.env.class).toBe('test');
    payload = await payloadOf(deps)();
    live = liveOf(deps);
    dispatch = await buildDispatcher(deps);
    fake = (await startFakeYoutube({ port: 0 })) as Fake;
    savedStatuses = live.statuses;
    (live as { statuses?: LiveWiring['statuses'] }).statuses = createYoutubeFakeSource(fake.url) as LiveWiring['statuses'];
    await clean();
    let events = (await live.events.events()).filter((e) => !e.hidden);
    if (events.length === 0) {
      await createTinyCatalog(payload, RUN);
      tinyMade = true;
      events = (await live.events.events()).filter((e) => !e.hidden);
    }
    eventId = String(events[0]?.eventId ?? '');
    expect(eventId).not.toBe('');
    await makeAdmin(payload, OWNER, PASSWORD, 'owner');
    owner = { cookie: await sessionCookie(payload, OWNER, PASSWORD), ...personMark() };
    const a = await issue(AGENT);
    agentId = a.id;
    key = a.key;
    agent = { ...apiKeyHeader(a.key), ...serviceMark() };
    const l = await issue(LIMITS);
    limitsId = l.id;
    limits = { ...apiKeyHeader(l.key), ...serviceMark() };
    const d = await issue(DAILY);
    dailyId = d.id;
    daily = { ...apiKeyHeader(d.key), ...serviceMark() };
    journalStart = await maxJournalId();

    // Everything the process writes while the suite runs (never printed by the assertions).
    for (const stream of [process.stdout, process.stderr]) {
      const original = stream.write.bind(stream);
      stream.write = ((chunk: unknown, ...more: unknown[]) => {
        logged.push(String(chunk));
        return (original as (...x: unknown[]) => boolean)(chunk, ...more);
      }) as typeof stream.write;
      restoreLog.push(() => (stream.write = original));
    }
  });

  afterAll(async () => {
    for (const r of restoreLog) r();
    if (live) (live as { statuses?: LiveWiring['statuses'] }).statuses = savedStatuses;
    if (!payload) return;
    await clean();
    const buckets = [agentId, limitsId, dailyId].map((id) => `agent:${id}`);
    for (const b of buckets) await db().execute(sql`DELETE FROM "live_quota" WHERE "bucket" = ${b}`);
    await removeAdmins(payload, [OWNER, AGENT, LIMITS, DAILY]);
    if (tinyMade) await removeTinyCatalog(payload, RUN);
    await fake?.close();
  });

  it('AC-33: each of the three addresses works and matches its contract; oversize and extra fields → invalid', async () => {
    await control('channels', { channels: [{ id: BLACK, videos: [vid(90)] }] });
    const ch = await rest('GET', '/stream-agent/channels', { headers: agent });
    expect(ch.status).toBe(200);
    expect(ch.headers.get('cache-control')).toBe('no-store');
    const chBody = await json(ch);
    expect(AgentChannelsResponseSchema.safeParse(chBody.value).success).toBe(true);

    await upcoming([vid(1)]);
    const posted = await propose({ videoId: vid(1), eventId, evidenceUrl: 'https://example.com/schedule', note: 'Анонс' });
    expect(posted.status).toBe(200);
    const postBody = await json(posted);
    expect(AgentProposeResultSchema.safeParse(postBody.value).success).toBe(true);
    expect(postBody.value).toMatchObject({ videoId: vid(1), state: 'proposed', created: true });

    const list = await rest('GET', `/stream-agent/candidates?state=proposed&eventId=${encodeURIComponent(eventId)}`, { headers: agent });
    expect(list.status).toBe(200);
    const listBody = await json(list);
    expect(AgentCandidatesResponseSchema.safeParse(listBody.value).success).toBe(true);
    expect((listBody.value?.items as { videoId: string }[]).map((c) => c.videoId)).toContain(vid(1));

    const before = await candidateRows();
    const base = { videoId: vid(2), note: '' };
    const big = { ...base, note: 'x'.repeat(1025 - JSON.stringify(base).length) };
    expect(Buffer.byteLength(JSON.stringify(big))).toBe(1025);
    const over = await propose(big);
    expect(over.status).toBe(400);
    expect((await json(over)).error?.code).toBe('invalid');
    const extra = await propose({ videoId: vid(2), approve: true });
    expect(extra.status).toBe(400);
    expect((await json(extra)).error?.code).toBe('invalid');
    const both = await propose({ videoId: vid(2), channelId: BLACK });
    expect(both.status).toBe(400);
    expect(await candidateRows()).toEqual(before);
  });

  it('AC-31: 10 proposals → proposed, journal actor agent; the live version and the public chains unchanged', async () => {
    const ids = Array.from({ length: 10 }, (_, i) => vid(10 + i));
    await upcoming(ids);
    const version = (await live.store.state()).version;
    const chainsBefore = await chains();
    const mark = await maxJournalId();
    for (const id of ids) {
      const res = await propose({ videoId: id, eventId });
      expect(res.status).toBe(200);
      expect((await json(res)).value).toMatchObject({ videoId: id, state: 'proposed' });
    }
    const rows = await rowsAfter(mark);
    expect(rows).toHaveLength(10);
    for (const r of rows) {
      expect(r.action).toBe(STREAMS_CANDIDATE_ACTION);
      expect(r.actor).toMatchObject({ kind: 'agent', ref: String(agentId) });
    }
    expect((await live.store.state()).version).toBe(version);
    expect(await chains()).toBe(chainsBefore);
  });

  it('AC-32: every owner and live action and direct collection writes → 403; nothing changes', async () => {
    const candidates = await candidateRows();
    const channels = await channelRows();
    const version = (await live.store.state()).version;
    const mark = await maxJournalId();
    const body = { videoId: vid(10), channelId: BLACK, eventId, reason: 'спроба' };
    expect((await rest('GET', '/streams/view', { headers: agent })).status).toBe(403);
    for (const action of STREAMS_ACTIONS) {
      expect((await rest('POST', `/streams/${action}`, { headers: agent, body: { ...body, action } })).status, action).toBe(403);
    }
    expect((await rest('GET', '/live/view', { headers: agent })).status).toBe(403);
    for (const action of LIVE_ACTIONS) {
      expect((await rest('POST', `/live/${action}`, { headers: agent, body: { action, eventId, reason: 'спроба' } })).status, action).toBe(403);
    }
    for (const slug of ['stream-channels', 'stream-candidates', 'stream-sources']) {
      expect((await rest('POST', `/${slug}`, { headers: agent, body: { channelId: chid(9), videoId: vid(9), state: 'approved' } })).status, slug).toBe(403);
      expect((await rest('GET', `/${slug}`, { headers: agent })).status, slug).toBe(403);
    }
    expect((await rest('POST', '/stream-agent/channels', { headers: agent, body: { channelId: chid(9) } })).status).toBeGreaterThanOrEqual(400);
    expect(await candidateRows()).toEqual(candidates);
    expect(await channelRows()).toEqual(channels);
    expect((await live.store.state()).version).toBe(version);
    expect(await rowsAfter(mark)).toHaveLength(0);
  });

  it('AC-3: the agent proposes a video of a blacklisted channel → rejected/blacklisted', async () => {
    await control('channels', { channels: [{ id: BLACK, videos: [vid(90)] }] });
    await upcoming([vid(90)]);
    const added = await rest('POST', '/streams/channel-add', {
      headers: owner,
      body: { action: 'channel-add', channelId: BLACK, name: `Чорний ${R}`, kind: 'tv', zones: [], priority: 3 },
    });
    expect(added.status, await added.clone().text()).toBe(200);
    // The channel's first uploads page already brought vid(90) in; remove it so the agent's proposal is a new row.
    await db().execute(sql`DELETE FROM "stream_candidates" WHERE "video_id" = ${vid(90)}`);
    const black = await rest('POST', '/streams/blacklist', { headers: owner, body: { action: 'blacklist', channelId: BLACK, reason: `Спам ${R}` } });
    expect(black.status, await black.clone().text()).toBe(200);
    const res = await propose({ videoId: vid(90), eventId });
    expect(res.status).toBe(200);
    expect((await json(res)).value).toMatchObject({ videoId: vid(90), state: 'rejected', reason: 'blacklisted' });
    const read = await json(await rest('GET', '/stream-agent/channels', { headers: agent }));
    expect(read.value?.blacklist).toContain(BLACK);
    expect((read.value?.channels as { channelId: string }[]).map((c) => c.channelId)).not.toContain(BLACK);
  });

  it('AC-37: the 31st proposal and the 61st read in a minute, the 301st proposal of the day → 429 rate-limited', async () => {
    await upcoming([vid(40)]);
    for (let i = 0; i < 30; i++) expect((await propose({ videoId: vid(40) }, limits)).status, `proposal ${i + 1}`).toBe(200);
    const over = await propose({ videoId: vid(41) }, limits);
    expect(over.status).toBe(429);
    const overBody = await json(over);
    expect(overBody).toMatchObject({ ok: false, error: { code: 'rate-limited' } });
    expect(overBody.error?.retryAfterMs).toBeGreaterThan(0);
    for (let i = 0; i < 60; i++) expect((await rest('GET', '/stream-agent/channels', { headers: limits })).status, `read ${i + 1}`).toBe(200);
    const readOver = await rest('GET', '/stream-agent/candidates', { headers: limits });
    expect(readOver.status).toBe(429);
    expect((await json(readOver)).error?.code).toBe('rate-limited');

    // The daily cap: 299 proposals already counted today for this agent; the 300th passes, the 301st is refused.
    const now = deps.clock.now();
    const day = quotaDay(now, live.cfg.dayTimeZone);
    await live.quota.charge(day, `agent:${dailyId}` as QuotaCounterKey, live.cfg.agent.proposalsPerDay - 1);
    await upcoming([vid(42), vid(43)]);
    expect((await propose({ videoId: vid(42) }, daily)).status).toBe(200);
    const capped = await propose({ videoId: vid(43) }, daily);
    expect(capped.status).toBe(429);
    const cappedBody = await json(capped);
    expect(cappedBody.error?.code).toBe('rate-limited');
    const toBoundary = nextDayBoundary(now, live.cfg.dayTimeZone) - now;
    expect(cappedBody.error?.retryAfterMs).toBeGreaterThan(0);
    expect(Math.abs(Number(cappedBody.error?.retryAfterMs) - toBoundary)).toBeLessThan(120_000);
    expect((await candidateRows()).map((r) => r.video_id)).not.toContain(vid(43));
  });

  it('AC-38: propose → revoke → the very next proposal and read are refused', async () => {
    await upcoming([vid(60), vid(61)]);
    expect((await propose({ videoId: vid(60) })).status).toBe(200);
    expect((await rest('POST', `/admins/${agentId}/revoke-key`, { headers: owner })).status).toBe(200);
    const next = await propose({ videoId: vid(61) });
    expect(next.status).toBe(403);
    expect((await json(next)).error?.code).toBe('forbidden');
    expect((await rest('GET', '/stream-agent/candidates', { headers: agent })).status).toBe(403);
    expect((await rest('GET', '/stream-agent/channels', { headers: agent })).status).toBe(403);
    expect((await candidateRows()).map((r) => r.video_id)).not.toContain(vid(61));
  });

  it('NFR-3, NFR-6: the key is nowhere (responses, journal, outbox, log); the log has no videoId', async () => {
    expect(key).not.toBe('');
    const journal = JSON.stringify(await rowsAfter(journalStart));
    const outbox = JSON.stringify((await db().execute(sql`SELECT "payload" FROM "internal_events" ORDER BY "id" DESC LIMIT 500`)).rows);
    const log = logged.join('\n');
    for (const [name, text] of [['responses', bodies.join('\n')], ['journal', journal], ['outbox', outbox], ['log', log]] as const) {
      expect(text.split(key).length - 1, name).toBe(0);
    }
    for (const id of videoIds) expect(log.includes(id), 'videoId in the log').toBe(false);
  });
});
