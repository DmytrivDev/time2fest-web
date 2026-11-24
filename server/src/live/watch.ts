/**
 * The sources watch (SPEC-21a [П-4]), ring 3: one pass every `watchPassMs` under the `live-sources` lease — only the
 * lease holder works, and a pass never overlaps the previous one.
 *
 * A pass, in queue order of the quota classes:
 * 1. retries the candidates left unchecked (AC-13, class `candidates`);
 * 2. refreshes the uploads playlist of the watched channels that need it (`refreshDue`, AC-27): one `channels.list`
 *    per batch (class `playlists`); a channel YouTube no longer returns goes `off` with one journal row (actor system);
 * 3. reads the first uploads page of every watched channel whose read is due ([А4], AC-26, class `playlists`); new
 *    ids become candidates of origin `playlist` (AC-11, AC-3); a playlist `not-found` → one `channels.list` (AC-27);
 * 4. one lawful `search.list` per channel and open search window without a live candidate of that event (AC-28,
 *    bucket `search`); a refused search is skipped without a request (AC-29), the playlist watch goes on;
 * 5. every `RETENTION_RUN_MS` the candidate retention (AC-46): refresh, strip, archive (journal actor system).
 *
 * Every call goes through `countedCall`: allowed and charged before the request (AC-25); `quotaExceeded` stops that
 * bucket until the quota-day boundary (AC-30) — the queue is never touched by it. Logs and alarms carry codes and
 * counts only.
 */
import { VIDEO_ID_PATTERN } from '@time2fest/contracts';
import type { Actor } from '../audit/ports';
import { transition } from '../domain/live/candidates';
import { playlistDue, refreshDue, searchDue, type ZoneMoment } from '../domain/live/channels';
import type { LiveEvent } from '../domain/live/moment';
import type { YoutubeVideoState } from '../domain/live/status';
import type { LiveLease, SearchSource, StoredCandidate, StoredStreamChannel } from './ports';
import { CLEARED_CANDIDATE_FIELDS, RETENTION_RUN_MS, runCandidateRetention, type Refreshed } from './retention';
import { addCandidates, countedCall, journalChannel, retryUnchecked, STREAMS_CANDIDATE_ACTION, type SourcesDeps } from './sources';

export const LIVE_SOURCES_LEASE = 'live-sources';
/** The watch actor of journal rows and `stateChangedBy` (as the sources services' own server actor). */
const SYSTEM: Actor = Object.freeze({ kind: 'system', id: 'live-sources', label: 'live-sources' });
const BY = `${SYSTEM.kind}:${SYSTEM.id}`;
const LIVE_QUEUE = ['proposed', 'approved', 'active'] as const;

export interface WatchDeps extends SourcesDeps {
  lease: LiveLease;
  youtube?: SourcesDeps['youtube'] & SearchSource;
}

export interface WatchReport {
  /** False when another instance holds the lease, a pass was still running, or no YouTube source is wired. */
  ran: boolean;
  retried: number;
  refreshed: number;
  off: number;
  playlists: number;
  searches: number;
  added: number;
  retention?: { refreshed: number; stripped: number; archived: number };
}

export interface StreamsWatch {
  tick(): Promise<WatchReport>;
  /** Lets the lease go (graceful stop). */
  release(): Promise<void>;
}

const idle = (): WatchReport => ({ ran: false, retried: 0, refreshed: 0, off: 0, playlists: 0, searches: 0, added: 0 });

/** The candidate fields of a fresh `videos.list` answer (as the cheap check writes them). */
function youtubeFields(v: YoutubeVideoState, at: number): Partial<StoredCandidate> {
  return {
    ...(v.channelId ? { channelId: v.channelId } : {}),
    liveBroadcastContent: v.liveBroadcastContent ?? null,
    scheduledStartTime: v.scheduledStartTime ? Date.parse(v.scheduledStartTime) || null : null,
    embeddable: v.embeddable ?? null,
    privacyStatus: v.privacyStatus ?? null,
    ytFetchedAt: at,
  };
}

export function createStreamsWatch(deps: WatchDeps): StreamsWatch {
  const { cfg } = deps;
  let running = false;
  let lastRetentionAt: number | null = null;
  /** Lease term: four passes, so one slow pass does not hand the lease over. */
  const leaseTtl = 4 * cfg.watchPassMs;

  /** `channels.list` of `due` in batches; found → new uploads id, gone → `off` + journal row. Returns [refreshed, off]. */
  async function refreshChannels(yt: NonNullable<WatchDeps['youtube']>, due: StoredStreamChannel[]): Promise<[number, number]> {
    let refreshed = 0;
    let off = 0;
    for (let i = 0; i < due.length; i += cfg.batchSize) {
      const batch = due.slice(i, i + cfg.batchSize);
      const result = await countedCall(deps, 'playlists', () => yt.channels(batch.map((c) => c.channelId)));
      if (!result.ok) continue;
      const at = deps.clock.now();
      const found = new Map(result.value.channels.map((c) => [c.id, c.uploadsPlaylistId]));
      await deps.live.inTransaction(null, async (tx) => {
        for (const c of batch) {
          const [have] = await deps.streams.channels({ channelIds: [c.channelId] }, tx);
          if (!have || have.state !== 'watched') continue;
          const uploads = found.get(c.channelId);
          if (uploads) {
            await deps.streams.saveChannel(tx, { channelId: c.channelId, uploadsPlaylistId: uploads, uploadsFetchedAt: at });
            Object.assign(c, { uploadsPlaylistId: uploads, uploadsFetchedAt: at });
            refreshed += 1;
          } else {
            const next: StoredStreamChannel = { ...have, state: 'off' };
            await deps.streams.saveChannel(tx, { channelId: c.channelId, state: 'off' });
            await journalChannel(deps, tx, SYSTEM, have, next);
            c.state = 'off';
            off += 1;
          }
        }
      });
    }
    return [refreshed, off];
  }

  async function addFound(videoIds: readonly string[], origin: 'playlist' | 'search'): Promise<number> {
    const ids = [...new Set(videoIds.filter((id) => VIDEO_ID_PATTERN.test(id)))];
    if (ids.length === 0) return 0;
    const result = await addCandidates(deps, { videoIds: ids, origin, actor: SYSTEM });
    return result.ok ? result.value.filter((o) => o.created).length : 0;
  }

  /** AC-46: refresh / strip / archive, writes in one transaction. */
  async function retention(yt: NonNullable<WatchDeps['youtube']>, now: number): Promise<NonNullable<WatchReport['retention']>> {
    const all = await deps.streams.candidates();
    const plan = await runCandidateRetention(
      all.map((c) => ({ videoId: c.videoId, state: c.state, ytFetchedAt: c.ytFetchedAt, stateChangedAt: c.stateChangedAt ?? now })),
      now,
      cfg,
      async (ids): Promise<Refreshed> => {
        const answers = new Map<string, YoutubeVideoState | undefined>();
        for (let i = 0; i < ids.length; i += cfg.batchSize) {
          const batch = ids.slice(i, i + cfg.batchSize);
          const result = await countedCall(deps, 'candidates', () => yt.list(batch));
          if (!result.ok) continue;
          const byId = new Map(result.value.items.map((v) => [v.videoId, v]));
          for (const id of batch) answers.set(id, byId.get(id));
        }
        return answers;
      },
    );
    const at = deps.clock.now();
    const archive = new Set(plan.archive);
    await deps.live.inTransaction(null, async (tx) => {
      for (const [videoId, v] of plan.refreshed) await deps.streams.saveCandidate(tx, { videoId, ...youtubeFields(v, at) }, BY, at);
      for (const videoId of plan.strip) {
        if (!archive.has(videoId)) await deps.streams.saveCandidate(tx, { videoId, ...CLEARED_CANDIDATE_FIELDS }, BY, at);
      }
      for (const videoId of plan.archive) {
        const [have] = await deps.streams.candidates({ videoIds: [videoId] }, tx);
        if (!have || !transition(have.state, 'archive', 'server').ok) continue;
        // The decision time and author stay (AC-46): the archive is recorded by the journal row.
        await deps.streams.saveCandidate(tx, { videoId, state: 'archive', ...CLEARED_CANDIDATE_FIELDS }, have.stateChangedBy ?? BY, have.stateChangedAt ?? at);
        const view = { videoId, reason: have.reason ?? null, eventId: have.eventId ?? null, foundBy: [...have.foundBy] };
        await deps.journal.append(tx, {
          actor: SYSTEM,
          action: STREAMS_CANDIDATE_ACTION,
          target: { collection: 'stream-candidates', id: videoId },
          at,
          before: { ...view, state: have.state },
          after: { ...view, state: 'archive' },
          revertOf: null,
        });
      }
    });
    return { refreshed: plan.refreshed.size, stripped: plan.strip.filter((id) => !archive.has(id)).length, archived: plan.archive.length };
  }

  async function pass(yt: NonNullable<WatchDeps['youtube']>): Promise<WatchReport> {
    const report: WatchReport = { ...idle(), ran: true };
    report.retried = await retryUnchecked(deps);

    const events = (await deps.events.events()).filter((e) => !e.hidden);
    const momentsOf = (c: StoredStreamChannel): ZoneMoment[] =>
      events.filter((e: LiveEvent) => c.zones.includes(e.zoneId)).map((e) => ({ eventId: e.eventId, moment: e.moment }));
    const channels = await deps.streams.channels({ state: 'watched', blacklisted: false });

    let now = deps.clock.now();
    const refreshedIds = new Set<string>();
    const due = channels.filter((c) => refreshDue(c, now, cfg));
    for (const c of due) refreshedIds.add(c.channelId);
    [report.refreshed, report.off] = await refreshChannels(yt, due);

    // Playlists (AC-26); a `not-found` playlist → one `channels.list` refresh (AC-27).
    const notFound: StoredStreamChannel[] = [];
    for (const c of channels) {
      now = deps.clock.now();
      const moments = momentsOf(c).map((z) => z.moment);
      if (!playlistDue(c, moments, now, cfg)) continue;
      const playlistId = c.uploadsPlaylistId as string;
      const page = await countedCall(deps, 'playlists', async () => {
        const r = await yt.firstPage(playlistId);
        return r.ok ? { videoIds: r.videoIds, notFound: false } : r.reason === 'not-found' ? { videoIds: [] as string[], notFound: true } : { error: r.reason };
      });
      if (!page.ok) {
        // A failed request was charged: the next read waits for the interval; a refused one (quota) is retried.
        if (page.refusal === 'unavailable' || page.refusal === 'invalid') {
          await deps.live.inTransaction(null, (tx) => deps.streams.saveChannel(tx, { channelId: c.channelId, lastPlaylistAt: now }));
        }
        continue;
      }
      report.playlists += 1;
      await deps.live.inTransaction(null, (tx) => deps.streams.saveChannel(tx, { channelId: c.channelId, lastPlaylistAt: now }));
      c.lastPlaylistAt = now;
      if (page.value.notFound) {
        if (!refreshedIds.has(c.channelId)) notFound.push(c);
        continue;
      }
      report.added += await addFound(page.value.videoIds ?? [], 'playlist');
    }
    if (notFound.length) {
      const [refreshed, off] = await refreshChannels(yt, notFound);
      report.refreshed += refreshed;
      report.off += off;
    }

    // Lawful search (AC-28, AC-29).
    const live = await deps.streams.candidates({ states: [...LIVE_QUEUE] });
    const liveEvents = new Set(live.map((c) => c.eventId).filter((e): e is string => !!e));
    for (const c of channels) {
      if (c.state !== 'watched') continue;
      now = deps.clock.now();
      const z = searchDue(c, momentsOf(c), (eventId) => liveEvents.has(eventId), now, cfg);
      if (!z) continue;
      const found = await countedCall(deps, 'search', () => yt.search({ channelId: c.channelId }));
      if (!found.ok && !(found.refusal === 'unavailable' || found.refusal === 'invalid')) continue;
      await deps.live.inTransaction(null, (tx) => deps.streams.saveChannel(tx, { channelId: c.channelId, lastSearchAt: now }));
      c.lastSearchAt = now;
      if (!found.ok) continue;
      report.searches += 1;
      report.added += await addFound(found.value.ids, 'search');
    }

    now = deps.clock.now();
    if (lastRetentionAt === null || now < lastRetentionAt || now - lastRetentionAt >= RETENTION_RUN_MS) {
      lastRetentionAt = now;
      report.retention = await retention(yt, now);
    }
    return report;
  }

  return {
    async tick() {
      const yt = deps.youtube;
      if (running || !yt) return idle();
      running = true;
      try {
        if (!(await deps.lease.acquire(LIVE_SOURCES_LEASE, leaseTtl))) return idle();
        return await pass(yt);
      } finally {
        running = false;
      }
    },
    release: () => deps.lease.release(LIVE_SOURCES_LEASE),
  };
}
