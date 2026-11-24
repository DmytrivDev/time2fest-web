/**
 * Stream sources services (SPEC-21a FR-LIVE-08 … FR-LIVE-10, FR-LIVE-13), ring 3: channels and blacklist, the candidate
 * queue with its cheap check, approval into a chain. No Payload import, no `Date.now()`: time is the injected clock.
 *
 * - Ids are checked against the patterns first (AC-14): a bad id is `invalid` and YouTube is never asked.
 * - Every YouTube call goes through the SPEC-12 allow rule of its class and is charged BEFORE the request (AC-25):
 *   `videos.list` of candidates → `candidates`, `channels.list` / `playlistItems.list` → `playlists`. A refused,
 *   failed or `quotaExceeded` check leaves the candidate `new` with an empty `checkedAt` (AC-13); `quotaExceeded`
 *   stops the bucket for the quota day (SPEC-12 AC-35).
 * - Network calls run before the write transaction; the writes of one action (rows, journal, event) are ONE
 *   transaction. Every owner / agent change writes one journal row in it (NFR-6); a server change writes one row
 *   when it moves an existing candidate (blacklist cascades are part of the blacklist row; candidates found by the
 *   playlist / search pass of the server write none).
 * - Approve ([П-5], AC-16 … AC-19, AC-23): the SPEC-12 replace write path with the candidate's YouTube fields.
 * Logs and alarms carry codes and counts only — never a videoId, a channelId or an agent note.
 */
import { CHANNEL_ID_PATTERN, CHANNEL_PRIORITIES, FOUND_BY, STREAMS_REASON_MAX, VIDEO_ID_PATTERN, type CandidateReason, type CandidateState, type ChannelKind, type ChannelState, type FoundBy } from '@time2fest/contracts';
import type { Actor, Journal, RevertHandler, StoredJournalEntry } from '../audit/ports';
import { capForAgent, chainFull, checkIsFresh, cheapVerdict, mergeOrigin, transition, type CandidateActor } from '../domain/live/candidates';
import { canWatchMore } from '../domain/live/channels';
import type { LiveConfig } from '../domain/live/config';
import { allow, nextDayBoundary, quotaDay, type CallerContext, type CeiledClass, type QuotaRefusal } from '../domain/live/quota';
import type { YoutubeVideoState } from '../domain/live/status';
import type { EventPublisher } from '../events/ports';
import type { Alarm, Clock } from '../ports';
import { checkOf, LIVE_CHANGED_TOPIC, type LiveChangedPayload } from './poller';
import type {
  ChannelSource,
  LiveEventSource,
  LiveSource,
  LiveStore,
  PlaylistSource,
  QuotaStore,
  StoredCandidate,
  StoredStreamChannel,
  StreamsStore,
  Tx,
  VideoStatusError,
  VideoStatusSource,
} from './ports';

export const LIVE_APPROVE_ACTION = 'live.approve';
export const STREAMS_CANDIDATE_ACTION = 'streams.candidate';
export const STREAMS_CHANNEL_ACTION = 'streams.channel';
export const STREAMS_BLACKLIST_ACTION = 'streams.blacklist';

const CANDIDATES = 'stream-candidates';
const CHANNELS = 'stream-channels';
const SOURCES = 'stream-sources';
const ALARM_SOURCE = 'live';
/** The lowest priority: a channel added without one. */
const DEFAULT_PRIORITY: number = CHANNEL_PRIORITIES[CHANNEL_PRIORITIES.length - 1] as number;
const SYSTEM: Actor = Object.freeze({ kind: 'system', id: 'live-sources', label: 'live-sources' });

export interface SourcesDeps {
  live: LiveStore;
  streams: StreamsStore;
  quota: QuotaStore;
  /** Absent = no YouTube source wired: every check is "not possible" (AC-13), a channel cannot be added. */
  youtube?: VideoStatusSource & ChannelSource & PlaylistSource;
  events: LiveEventSource;
  journal: Journal;
  publisher: EventPublisher;
  alarm: Alarm;
  clock: Clock;
  cfg: LiveConfig;
  caller: CallerContext;
}

export type SourcesRefusal = 'invalid' | 'forbidden' | 'not-found' | 'limit' | 'invalid-state' | 'chain-full' | 'unavailable';
export type SourcesResult<T> = { ok: true; value: T } | { ok: false; code: SourcesRefusal; detail?: string };

export interface CandidateOutcome {
  videoId: string;
  state: CandidateState;
  reason?: CandidateReason;
  created: boolean;
}

export interface ChannelOutcome {
  channelId: string;
  state: ChannelState;
  created: boolean;
  /** Candidates added from the first uploads page (AC-12). */
  added: number;
}

const ok = <T>(value: T): SourcesResult<T> => ({ ok: true, value });
const no = <T>(code: SourcesRefusal, detail?: string): SourcesResult<T> => (detail ? { ok: false, code, detail } : { ok: false, code });

const actorOf = (actor: Actor): CandidateActor => (actor.kind === 'owner' ? 'owner' : actor.kind === 'agent' ? 'agent' : 'server');
const byOf = (actor: Actor) => `${actor.kind}:${actor.id}`;

// ---- counted calls (AC-25) ----

export type CountedResult<T> = { ok: true; value: T } | { ok: false; refusal: QuotaRefusal | VideoStatusError | 'not-wired' };

/**
 * One YouTube call of a ceiled class: allowed by the SPEC-12 rule, charged to `queries` and to the class counter
 * before the request (a failed call counts too), `live/quota-80` on the first crossing, `quotaExceeded` stops the
 * `queries` bucket until the quota day ends.
 */
export async function countedCall<T>(
  deps: Pick<SourcesDeps, 'quota' | 'alarm' | 'clock' | 'cfg' | 'caller'>,
  cls: CeiledClass,
  call: () => Promise<T | { error: VideoStatusError }>,
): Promise<CountedResult<T>> {
  const { cfg } = deps;
  const now = deps.clock.now();
  const day = quotaDay(now, cfg.dayTimeZone);
  const decision = allow(await deps.quota.read(day), cls, now, cfg, deps.caller, 1);
  if (!decision.ok) return { ok: false, refusal: decision.reason };
  const used = await deps.quota.charge(day, 'queries', decision.units);
  await deps.quota.charge(day, cls, decision.units);
  if (used >= cfg.alarmRatio * cfg.buckets.queries.perDay && (await deps.quota.mark80(day, 'queries', now))) {
    deps.alarm.raise({ level: 'page', source: ALARM_SOURCE, code: 'live/quota-80', details: { bucket: 'queries' } });
  }
  let result: T | { error: VideoStatusError };
  try {
    result = await call();
  } catch {
    return { ok: false, refusal: 'unavailable' };
  }
  if (result && typeof result === 'object' && 'error' in result) {
    const error = (result as { error: VideoStatusError }).error;
    if (error === 'quota-exceeded' && (await deps.quota.markExceeded(day, 'queries', nextDayBoundary(now, cfg.dayTimeZone)))) {
      deps.alarm.raise({ level: 'log', source: ALARM_SOURCE, code: 'live/quota-exceeded', details: { bucket: 'queries' } });
    }
    return { ok: false, refusal: error };
  }
  return { ok: true, value: result as T };
}

// ---- the cheap check ----

/** A checked id: the video as YouTube returned it (`null` = not returned), or not checked at all. */
type Check = { checked: true; video: YoutubeVideoState | null; at: number } | { checked: false };

/** `videos.list` of the ids in batches of `batchSize`, class `candidates`. */
async function checkIds(deps: SourcesDeps, ids: readonly string[]): Promise<Map<string, Check>> {
  const out = new Map<string, Check>();
  for (let i = 0; i < ids.length; i += deps.cfg.batchSize) {
    const batch = ids.slice(i, i + deps.cfg.batchSize);
    const youtube = deps.youtube;
    const result = youtube ? await countedCall(deps, 'candidates', () => youtube.list(batch)) : ({ ok: false, refusal: 'not-wired' } as const);
    const at = deps.clock.now();
    if (!result.ok) {
      for (const id of batch) out.set(id, { checked: false });
      continue;
    }
    const byId = new Map(result.value.items.map((v) => [v.videoId, v]));
    for (const id of batch) out.set(id, { checked: true, video: byId.get(id) ?? null, at });
  }
  return out;
}

async function blacklistedIds(deps: SourcesDeps, tx?: Tx): Promise<Set<string>> {
  return new Set((await deps.streams.channels({ blacklisted: true }, tx)).map((c) => c.channelId));
}

/** The candidate fields a check writes (AC-7). */
function checkedFields(check: Check): Partial<StoredCandidate> {
  if (!check.checked) return { checkedAt: null };
  const v = check.video;
  if (!v) return { checkedAt: check.at };
  return {
    channelId: v.channelId ?? null,
    liveBroadcastContent: v.liveBroadcastContent ?? null,
    scheduledStartTime: v.scheduledStartTime ? Date.parse(v.scheduledStartTime) || null : null,
    embeddable: v.embeddable ?? null,
    privacyStatus: v.privacyStatus ?? null,
    ytFetchedAt: check.at,
    checkedAt: check.at,
  };
}

const candidateView = (c: Pick<StoredCandidate, 'videoId' | 'state' | 'reason' | 'eventId' | 'foundBy'>) => ({
  videoId: c.videoId,
  state: c.state,
  reason: c.reason ?? null,
  eventId: c.eventId ?? null,
  foundBy: [...c.foundBy],
});

async function journalCandidate(deps: SourcesDeps, tx: Tx, actor: Actor, before: StoredCandidate | null, after: StoredCandidate, revertOf: string | null, extra: Record<string, unknown> = {}) {
  await deps.journal.append(tx, {
    actor,
    action: STREAMS_CANDIDATE_ACTION,
    target: { collection: CANDIDATES, id: after.videoId },
    at: deps.clock.now(),
    before: before ? candidateView(before) : null,
    after: { ...candidateView(after), ...extra },
    revertOf,
  });
}

export interface AddCandidatesInput {
  videoIds: readonly string[];
  origin: FoundBy;
  actor: Actor;
  eventId?: string;
  evidenceUrl?: string;
  note?: string;
}

/** The checks of the new ids of `input` (network, outside any transaction). */
async function prepareAdd(deps: SourcesDeps, ids: readonly string[]): Promise<Map<string, Check>> {
  const known = new Set((await deps.streams.candidates({ videoIds: ids })).map((c) => c.videoId));
  return checkIds(
    deps,
    ids.filter((id) => !known.has(id)),
  );
}

/** Writes the candidates of one add in `tx` (merge, verdict, agent cap, journal). */
async function writeAdd(deps: SourcesDeps, tx: Tx, input: AddCandidatesInput, ids: readonly string[], checks: ReadonlyMap<string, Check>): Promise<CandidateOutcome[]> {
  const now = deps.clock.now();
  const blacklisted = await blacklistedIds(deps, tx);
  const journalled = input.actor.kind !== 'system';
  const out: CandidateOutcome[] = [];
  for (const videoId of ids) {
    const [have] = await deps.streams.candidates({ videoIds: [videoId] }, tx);
    if (have) {
      // AC-9: one row, the origin joins; the state never changes here.
      const merged = mergeOrigin(have, input.origin);
      if (merged.changed) {
        const next: StoredCandidate = { ...have, foundBy: merged.foundBy };
        await deps.streams.saveCandidate(tx, { videoId, foundBy: merged.foundBy }, byOf(input.actor), now);
        if (journalled) await journalCandidate(deps, tx, input.actor, have, next, null);
      }
      out.push({ videoId, state: have.state, ...(have.reason ? { reason: have.reason } : {}), created: false });
      continue;
    }
    const check = checks.get(videoId) ?? { checked: false };
    const verdict = check.checked ? cheapVerdict(check.video, blacklisted, input.eventId !== undefined) : ({ state: 'new' } as const);
    const state = input.actor.kind === 'agent' ? capForAgent(verdict.state) : verdict.state;
    const reason = verdict.state === 'rejected' ? verdict.reason : null;
    const row: StoredCandidate = {
      videoId,
      channelId: null,
      foundBy: [input.origin],
      state,
      reason,
      eventId: input.eventId ?? null,
      sourceId: null,
      liveBroadcastContent: null,
      scheduledStartTime: null,
      embeddable: null,
      privacyStatus: null,
      ytFetchedAt: null,
      checkedAt: null,
      stateChangedAt: now,
      stateChangedBy: byOf(input.actor),
      evidenceUrl: input.evidenceUrl ?? null,
      note: input.note ?? null,
      ...checkedFields(check),
    };
    await deps.streams.saveCandidate(tx, row, byOf(input.actor), now);
    if (journalled) await journalCandidate(deps, tx, input.actor, null, row, null);
    out.push({ videoId, state, ...(reason ? { reason } : {}), created: true });
  }
  return out;
}

const uniqueIds = (ids: readonly string[]) => [...new Set(ids)];

/**
 * Adds candidates by videoId (AC-9, AC-11, AC-13, AC-14): a bad id → `invalid` with no YouTube call; one cheap check
 * per new id; known ids merge their origin. One transaction for every row of the call.
 */
export async function addCandidates(deps: SourcesDeps, input: AddCandidatesInput): Promise<SourcesResult<CandidateOutcome[]>> {
  if (input.videoIds.length === 0 || input.videoIds.some((id) => !VIDEO_ID_PATTERN.test(id))) return no('invalid', 'video-id');
  if (!FOUND_BY.includes(input.origin)) return no('invalid', 'origin');
  if (input.eventId !== undefined && !(await deps.events.events()).some((e) => e.eventId === input.eventId)) return no('not-found', 'event');
  const ids = uniqueIds(input.videoIds);
  const checks = await prepareAdd(deps, ids);
  return ok(await deps.live.inTransaction(null, (tx) => writeAdd(deps, tx, input, ids, checks)));
}

/**
 * Checks the candidates left unchecked (AC-13: `new` / `proposed` with an empty `checkedAt`) when the class allows
 * it; a check that fails keeps them as they are. Returns how many were checked.
 */
export async function retryUnchecked(deps: SourcesDeps, limit = deps.cfg.batchSize): Promise<number> {
  const waiting = (await deps.streams.candidates({ states: ['new', 'proposed'] })).filter((c) => c.checkedAt === null).slice(0, limit);
  if (waiting.length === 0) return 0;
  const checks = await checkIds(
    deps,
    waiting.map((c) => c.videoId),
  );
  return deps.live.inTransaction(null, async (tx) => {
    const blacklisted = await blacklistedIds(deps, tx);
    const now = deps.clock.now();
    let checked = 0;
    for (const id of checks.keys()) {
      const check = checks.get(id) as Check;
      if (!check.checked) continue;
      const [have] = await deps.streams.candidates({ videoIds: [id] }, tx);
      if (!have || have.checkedAt !== null || (have.state !== 'new' && have.state !== 'proposed')) continue;
      const verdict = cheapVerdict(check.video, blacklisted, have.state === 'proposed');
      const next: StoredCandidate = { ...have, ...checkedFields(check) };
      if (verdict.state === 'rejected' && transition(have.state, 'rejected', 'server').ok) {
        next.state = 'rejected';
        next.reason = verdict.reason;
      }
      await deps.streams.saveCandidate(tx, next, byOf(SYSTEM), now);
      if (next.state !== have.state) await journalCandidate(deps, tx, SYSTEM, have, next, null);
      checked += 1;
    }
    return checked;
  });
}

// ---- channels (AC-1 … AC-6, AC-12) ----

export interface ChannelFieldsInput {
  name?: string;
  kind?: ChannelKind;
  zones?: string[];
  priority?: number;
}

const channelView = (c: Pick<StoredStreamChannel, 'channelId' | 'name' | 'kind' | 'zones' | 'priority' | 'state'>) => ({
  channelId: c.channelId,
  name: c.name,
  kind: c.kind,
  zones: [...c.zones],
  priority: c.priority,
  state: c.state,
});

async function journalChannel(deps: SourcesDeps, tx: Tx, actor: Actor, before: StoredStreamChannel | null, after: StoredStreamChannel) {
  await deps.journal.append(tx, {
    actor,
    action: STREAMS_CHANNEL_ACTION,
    target: { collection: CHANNELS, id: after.channelId },
    at: deps.clock.now(),
    before: before ? channelView(before) : null,
    after: channelView(after),
    revertOf: null,
  });
}

/**
 * Adds a channel by channelId (AC-5, AC-6, AC-12): one `channels.list` (`playlists`) — unknown → `not-found`, nothing
 * written; the owner's channel is watched (within `maxWatchedChannels`, else `limit`), the agent's is `proposed`
 * and not watched; the first uploads page (`playlists`) becomes candidates of origin `playlist`.
 */
export async function addChannel(deps: SourcesDeps, input: { channelId: string; actor: Actor; fields?: ChannelFieldsInput; eventId?: string; evidenceUrl?: string; note?: string }): Promise<SourcesResult<ChannelOutcome>> {
  const { channelId, actor } = input;
  if (!CHANNEL_ID_PATTERN.test(channelId)) return no('invalid', 'channel-id');
  if (actor.kind === 'system') return no('forbidden');
  if (input.eventId !== undefined && !(await deps.events.events()).some((e) => e.eventId === input.eventId)) return no('not-found', 'event');
  const [have] = await deps.streams.channels({ channelIds: [channelId] });
  if (have) return ok({ channelId, state: have.state, created: false, added: 0 });
  const watched = actor.kind === 'owner';
  if (watched && !canWatchMore(await deps.streams.watchedCount(), deps.cfg)) return no('limit');
  const youtube = deps.youtube;
  if (!youtube) return no('unavailable');
  const listed = await countedCall(deps, 'playlists', () => youtube.channels([channelId]));
  if (!listed.ok) return no('unavailable', listed.refusal);
  const found = listed.value.channels.find((c) => c.id === channelId);
  if (!found) return no('not-found');
  const fetchedAt = deps.clock.now();
  const page = await countedCall(deps, 'playlists', async () => {
    const r = await youtube.firstPage(found.uploadsPlaylistId);
    return r.ok ? r : r.reason === 'not-found' ? { ok: true as const, videoIds: [] as string[] } : { error: r.reason };
  });
  const pageIds = page.ok ? uniqueIds(page.value.videoIds.filter((id) => VIDEO_ID_PATTERN.test(id))) : [];
  const checks = await prepareAdd(deps, pageIds);
  return deps.live.inTransaction(null, async (tx) => {
    const [raced] = await deps.streams.channels({ channelIds: [channelId] }, tx);
    if (raced) return ok({ channelId, state: raced.state, created: false, added: 0 });
    if (watched && !canWatchMore(await deps.streams.watchedCount(tx), deps.cfg)) return no<ChannelOutcome>('limit');
    const f = input.fields ?? {};
    const row: StoredStreamChannel = {
      channelId,
      uploadsPlaylistId: found.uploadsPlaylistId,
      uploadsFetchedAt: fetchedAt,
      name: f.name ?? channelId,
      kind: f.kind ?? 'tv',
      zones: f.zones ?? [],
      seasons: [],
      priority: f.priority ?? DEFAULT_PRIORITY,
      state: watched ? 'watched' : 'proposed',
      blacklisted: false,
      blacklistReason: null,
      blacklistSource: null,
      proposedBy: actor.kind === 'agent' ? actor.id : null,
      adminEditedAt: actor.kind === 'owner' ? fetchedAt : null,
      lastPlaylistAt: page.ok ? fetchedAt : null,
      lastSearchAt: null,
    };
    await deps.streams.saveChannel(tx, row);
    await journalChannel(deps, tx, actor, null, row);
    const added = await writeAdd(deps, tx, { videoIds: pageIds, origin: 'playlist', actor, ...(input.eventId ? { eventId: input.eventId } : {}) }, pageIds, checks);
    return ok({ channelId, state: row.state, created: true, added: added.filter((a) => a.created).length });
  });
}

/** Owner edit of a channel (AC-1): fields and `watched` / `off`; entering `watched` respects the limit (AC-6). */
export async function editChannel(deps: SourcesDeps, input: { channelId: string; actor: Actor; fields: ChannelFieldsInput; state?: 'watched' | 'off' }): Promise<SourcesResult<ChannelOutcome>> {
  if (input.actor.kind !== 'owner') return no('forbidden');
  if (!CHANNEL_ID_PATTERN.test(input.channelId)) return no('invalid', 'channel-id');
  return setChannel(deps, input.channelId, input.actor, (c) => ({ ...c, ...definedFields(input.fields), ...(input.state ? { state: input.state } : {}) }));
}

/** The owner approves a channel the agent proposed (AC-12): `proposed` → `watched` within the limit. */
export async function approveChannel(deps: SourcesDeps, input: { channelId: string; actor: Actor }): Promise<SourcesResult<ChannelOutcome>> {
  if (input.actor.kind !== 'owner') return no('forbidden');
  if (!CHANNEL_ID_PATTERN.test(input.channelId)) return no('invalid', 'channel-id');
  return setChannel(deps, input.channelId, input.actor, (c) => (c.state === 'proposed' ? { ...c, state: 'watched' } : null));
}

function definedFields(f: ChannelFieldsInput): Partial<StoredStreamChannel> {
  return Object.fromEntries(Object.entries(f).filter(([, v]) => v !== undefined)) as Partial<StoredStreamChannel>;
}

async function setChannel(deps: SourcesDeps, channelId: string, actor: Actor, change: (c: StoredStreamChannel) => StoredStreamChannel | null): Promise<SourcesResult<ChannelOutcome>> {
  return deps.live.inTransaction(null, async (tx) => {
    const [have] = await deps.streams.channels({ channelIds: [channelId] }, tx);
    if (!have) return no<ChannelOutcome>('not-found');
    const next = change(have);
    if (next === null) return no<ChannelOutcome>('invalid-state');
    if (JSON.stringify(channelView(next)) === JSON.stringify(channelView(have))) return ok({ channelId, state: have.state, created: false, added: 0 });
    if (next.state === 'watched' && have.state !== 'watched' && !canWatchMore(await deps.streams.watchedCount(tx), deps.cfg)) return no<ChannelOutcome>('limit');
    const row = { ...next, adminEditedAt: deps.clock.now() };
    await deps.streams.saveChannel(tx, row);
    await journalChannel(deps, tx, actor, have, row);
    return ok({ channelId, state: row.state, created: false, added: 0 });
  });
}

// ---- blacklist (AC-2 … AC-4) ----

export interface BlacklistOutcome {
  channelId: string;
  blacklisted: boolean;
  /** Candidates moved to `rejected/blacklisted` (AC-4). */
  rejected: number;
}

const BLACKLIST_REASON_MAX = STREAMS_REASON_MAX;

/**
 * Puts a channel on the blacklist or takes it off (AC-2), with the reason and one journal row. Blacklisting moves its
 * `new` / `proposed` candidates to `rejected/blacklisted` in the same transaction and leaves approved sources as they
 * are (AC-4). An unknown channel gets a row of its own (state `off`). Unblacklisting does not requeue anything.
 */
export async function setBlacklist(deps: SourcesDeps, input: { channelId: string; blacklisted: boolean; reason: string; actor: Actor }, tx: Tx | null = null, revertOf: string | null = null): Promise<SourcesResult<BlacklistOutcome>> {
  if (input.actor.kind !== 'owner') return no('forbidden');
  if (!CHANNEL_ID_PATTERN.test(input.channelId)) return no('invalid', 'channel-id');
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > BLACKLIST_REASON_MAX) return no('invalid', 'reason');
  return deps.live.inTransaction(tx, async (t) => {
    const { channelId, actor } = input;
    const now = deps.clock.now();
    const [have] = await deps.streams.channels({ channelIds: [channelId] }, t);
    if ((have?.blacklisted ?? false) === input.blacklisted) return ok({ channelId, blacklisted: input.blacklisted, rejected: 0 });
    await deps.streams.saveChannel(t, {
      channelId,
      ...(have ? {} : { state: 'off' as const }),
      blacklisted: input.blacklisted,
      blacklistReason: input.blacklisted ? reason : null,
      blacklistSource: input.blacklisted ? 'admin' : null,
      adminEditedAt: now,
    });
    const cascaded: { videoId: string; state: CandidateState }[] = [];
    if (input.blacklisted) {
      for (const c of await deps.streams.candidates({ channelId, states: ['new', 'proposed'] }, t)) {
        if (!transition(c.state, 'rejected', 'server').ok) continue;
        await deps.streams.saveCandidate(t, { videoId: c.videoId, state: 'rejected', reason: 'blacklisted' }, byOf(actor), now);
        cascaded.push({ videoId: c.videoId, state: c.state });
      }
    }
    await deps.journal.append(t, {
      actor,
      action: STREAMS_BLACKLIST_ACTION,
      target: { collection: CHANNELS, id: channelId },
      at: now,
      before: { channelId, blacklisted: have?.blacklisted ?? false, exists: have !== undefined },
      after: { channelId, blacklisted: input.blacklisted, reason, cascaded },
      revertOf,
    });
    return ok({ channelId, blacklisted: input.blacklisted, rejected: cascaded.length });
  });
}

// ---- owner decisions on candidates (AC-8) ----

async function moveCandidate(
  deps: SourcesDeps,
  input: { videoId: string; actor: Actor; to: CandidateState; reason: CandidateReason | null; note?: string },
): Promise<SourcesResult<CandidateOutcome>> {
  if (input.actor.kind !== 'owner') return no('forbidden');
  if (!VIDEO_ID_PATTERN.test(input.videoId)) return no('invalid', 'video-id');
  return deps.live.inTransaction(null, async (tx) => {
    const [have] = await deps.streams.candidates({ videoIds: [input.videoId] }, tx);
    if (!have) return no<CandidateOutcome>('not-found');
    if (!transition(have.state, input.to, actorOf(input.actor)).ok) return no<CandidateOutcome>('invalid-state');
    const next: StoredCandidate = { ...have, state: input.to, reason: input.reason };
    await deps.streams.saveCandidate(tx, { videoId: have.videoId, state: next.state, reason: next.reason }, byOf(input.actor), deps.clock.now());
    await journalCandidate(deps, tx, input.actor, have, next, null, input.note ? { note: input.note } : {});
    return ok({ videoId: have.videoId, state: next.state, ...(next.reason ? { reason: next.reason } : {}), created: false });
  });
}

/** The owner rejects a `new` / `proposed` candidate with a reason (journalled; the stored reason is `owner`). */
export async function rejectCandidate(deps: SourcesDeps, input: { videoId: string; actor: Actor; reason: string }): Promise<SourcesResult<CandidateOutcome>> {
  const reason = input.reason.trim();
  if (reason.length === 0 || reason.length > BLACKLIST_REASON_MAX) return no('invalid', 'reason');
  return moveCandidate(deps, { videoId: input.videoId, actor: input.actor, to: 'rejected', reason: 'owner', note: reason });
}

/** The owner returns a `rejected` candidate to the queue (`new`). */
export async function requeueCandidate(deps: SourcesDeps, input: { videoId: string; actor: Actor }): Promise<SourcesResult<CandidateOutcome>> {
  return moveCandidate(deps, { videoId: input.videoId, actor: input.actor, to: 'new', reason: null });
}

/** The agent moves a `new` candidate to `proposed` for an event (AC-8 row 2). */
export async function proposeCandidate(deps: SourcesDeps, input: { videoId: string; actor: Actor; eventId: string }): Promise<SourcesResult<CandidateOutcome>> {
  if (input.actor.kind === 'system') return no('forbidden');
  if (!VIDEO_ID_PATTERN.test(input.videoId)) return no('invalid', 'video-id');
  if (!(await deps.events.events()).some((e) => e.eventId === input.eventId)) return no('not-found', 'event');
  return deps.live.inTransaction(null, async (tx) => {
    const [have] = await deps.streams.candidates({ videoIds: [input.videoId] }, tx);
    if (!have) return no<CandidateOutcome>('not-found');
    if (!transition(have.state, 'proposed', actorOf(input.actor)).ok) return no<CandidateOutcome>('invalid-state');
    const next: StoredCandidate = { ...have, state: 'proposed', eventId: input.eventId };
    await deps.streams.saveCandidate(tx, { videoId: have.videoId, state: 'proposed', eventId: input.eventId }, byOf(input.actor), deps.clock.now());
    await journalCandidate(deps, tx, input.actor, have, next, null);
    return ok({ videoId: have.videoId, state: 'proposed', created: false });
  });
}

// ---- approve (AC-16 … AC-19, AC-23) ----

export interface ApproveOutcome {
  videoId: string;
  eventId: string;
  sourceId: string;
  version: number;
  /** A `videos.list` was made because the candidate's check was older than `candidateFreshMs` (AC-17). */
  rechecked: boolean;
}

/** The source id of an approved candidate: one per event and video (`src_<event>_<videoId>`, like `data/streams.json`). */
export function approvedSourceId(eventId: string, videoId: string): string {
  return `src_${eventId.replace(/^evt_/, '')}_${videoId}`;
}

const SOURCE_KINDS: ReadonlySet<string> = new Set(['webcam', 'tv']);

function videoOf(c: StoredCandidate): YoutubeVideoState {
  return {
    videoId: c.videoId,
    ...(c.channelId ? { channelId: c.channelId } : {}),
    liveBroadcastContent: c.liveBroadcastContent,
    privacyStatus: c.privacyStatus,
    embeddable: c.embeddable,
    scheduledStartTime: c.scheduledStartTime != null ? new Date(c.scheduledStartTime).toISOString() : null,
  };
}

/**
 * The owner approves a candidate for an event ([П-5]): a fresh check (≤ `candidateFreshMs`) is written into the new
 * source with its fetch time, else exactly one `videos.list` of the id runs first (a refused or failed call queues the
 * usual ad-hoc check instead). In ONE transaction: the source after the event's last one, version + 1, one
 * `live.approve` row, one `live.changed`, the candidate `approved` with its event and source. A second approve is
 * `invalid-state`; a chain with `maxSourcesPerEvent` active sources is `chain-full` with nothing written.
 */
export async function approveCandidate(deps: SourcesDeps, input: { videoId: string; eventId: string; actor: Actor; reason?: string }): Promise<SourcesResult<ApproveOutcome>> {
  if (input.actor.kind !== 'owner') return no('forbidden');
  if (!VIDEO_ID_PATTERN.test(input.videoId)) return no('invalid', 'video-id');
  const reason = input.reason?.trim();
  if (reason !== undefined && reason.length > BLACKLIST_REASON_MAX) return no('invalid', 'reason');
  const [first] = await deps.streams.candidates({ videoIds: [input.videoId] });
  if (!first) return no('not-found');
  if (!transition(first.state, 'approved', 'owner').ok) return no('invalid-state');
  if (!(await deps.events.events()).some((e) => e.eventId === input.eventId)) return no('not-found', 'event');
  if (chainFull(await deps.live.sources({ eventIds: [input.eventId] }), deps.cfg)) return no('chain-full');

  let fresh: { video: YoutubeVideoState | null; at: number } | null = null;
  let rechecked = false;
  if (checkIsFresh(first.ytFetchedAt, deps.clock.now(), deps.cfg)) fresh = { video: videoOf(first), at: first.ytFetchedAt as number };
  else {
    const check = (await checkIds(deps, [input.videoId])).get(input.videoId);
    rechecked = deps.youtube !== undefined;
    if (check?.checked) fresh = { video: check.video, at: check.at };
  }

  return deps.live.inTransaction(null, async (tx) => {
    const now = deps.clock.now();
    await deps.live.state(tx);
    const [have] = await deps.streams.candidates({ videoIds: [input.videoId] }, tx);
    if (!have) return no<ApproveOutcome>('not-found');
    if (!transition(have.state, 'approved', 'owner').ok) return no<ApproveOutcome>('invalid-state');
    const own = await deps.live.sources({ eventIds: [input.eventId] }, tx);
    if (chainFull(own, deps.cfg)) return no<ApproveOutcome>('chain-full');
    const sourceId = approvedSourceId(input.eventId, input.videoId);
    const [taken] = await deps.live.sources({ sourceIds: [sourceId] }, tx);
    if (taken) return no<ApproveOutcome>('invalid', 'source-exists');
    const [channel] = have.channelId ? await deps.streams.channels({ channelIds: [have.channelId] }, tx) : [];
    const order = own.length ? Math.max(...own.map((s) => s.order)) + 1 : 0;
    await deps.live.insertSource(tx, {
      sourceId,
      eventId: input.eventId,
      videoId: input.videoId,
      order,
      status: 'possible',
      adminEditedAt: now,
      ...(channel ? { name: channel.name, kind: SOURCE_KINDS.has(channel.kind) ? channel.kind : 'main' } : {}),
    });
    if (fresh) {
      const [inserted] = await deps.live.sources({ sourceIds: [sourceId] }, tx);
      const check = checkOf(inserted as LiveSource, fresh.video ?? undefined, now, deps.cfg);
      await deps.live.applyChecks(tx, [{ ...check, ...(check.youtube ? { youtube: { ...check.youtube, fetchedAt: fresh.at } } : {}), lastChecked: fresh.at }]);
    } else await deps.live.addPendingCheck({ sourceId, at: now }, tx);
    const next: StoredCandidate = { ...have, state: 'approved', eventId: input.eventId, sourceId, ...(rechecked && fresh ? checkedFields({ checked: true, video: fresh.video, at: fresh.at }) : {}) };
    await deps.streams.saveCandidate(tx, next, byOf(input.actor), now);
    const version = await deps.live.bumpVersion(tx);
    await deps.journal.append(tx, {
      actor: input.actor,
      action: LIVE_APPROVE_ACTION,
      target: { collection: SOURCES, id: sourceId },
      at: now,
      before: { videoId: input.videoId, state: have.state, eventId: have.eventId ?? null },
      after: { videoId: input.videoId, eventId: input.eventId, sourceId, state: 'approved', ...(reason ? { reason } : {}) },
      revertOf: null,
    });
    const payload: LiveChangedPayload = { version, eventIds: [input.eventId] };
    await deps.publisher.publish(tx, LIVE_CHANGED_TOPIC, payload);
    return ok({ videoId: input.videoId, eventId: input.eventId, sourceId, version, rechecked });
  });
}

// ---- revert (AC-2, AC-8, AC-19) ----

const text = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);

function unreadable(): never {
  throw new Error('streams revert: unreadable journal row');
}

/** The target's current value in the shape of the entry's `after`; `null` = this row cannot be reverted. */
async function currentOf(deps: SourcesDeps, tx: Tx, entry: StoredJournalEntry): Promise<Record<string, unknown> | null> {
  const after = entry.after;
  if (!after || !entry.before || entry.revertOf) return null;
  if (entry.action === STREAMS_BLACKLIST_ACTION) {
    const channelId = text(after.channelId);
    if (!channelId) return null;
    const [c] = await deps.streams.channels({ channelIds: [channelId] }, tx);
    return { channelId, blacklisted: c?.blacklisted ?? false, reason: after.blacklisted ? (c?.blacklistReason ?? null) : after.reason, cascaded: after.cascaded };
  }
  const videoId = text(after.videoId);
  if (!videoId) return null;
  const [c] = await deps.streams.candidates({ videoIds: [videoId] }, tx);
  if (!c) return null;
  if (entry.action === STREAMS_CANDIDATE_ACTION) return { ...candidateView(c), ...(after.note !== undefined ? { note: after.note } : {}) };
  // live.approve: the source still in place and the candidate still approved for it.
  const sourceId = text(after.sourceId);
  if (!sourceId || c.sourceId !== sourceId) return null;
  const [source] = await deps.live.sources({ sourceIds: [sourceId] }, tx);
  if (!source) return null;
  return { videoId, eventId: source.eventId, sourceId, state: c.state, ...(after.reason !== undefined ? { reason: after.reason } : {}) };
}

async function revertOne(deps: SourcesDeps, tx: Tx, entry: StoredJournalEntry, actor: Actor): Promise<void> {
  const before = entry.before ?? unreadable();
  const after = entry.after ?? unreadable();
  const now = deps.clock.now();
  if (entry.action === STREAMS_BLACKLIST_ACTION) {
    const channelId = text(before.channelId) ?? unreadable();
    const result = await setBlacklist(deps, { channelId, blacklisted: before.blacklisted === true, reason: `revert ${entry.id}`, actor }, tx, entry.id);
    if (!result.ok) throw new Error(`streams revert refused: ${result.code}`);
    // The candidates the blacklisting rejected go back to their state when they are still rejected for it.
    const cascaded = Array.isArray(after.cascaded) ? (after.cascaded as { videoId?: unknown; state?: unknown }[]) : [];
    for (const item of cascaded) {
      const videoId = text(item.videoId);
      const state = text(item.state) as CandidateState | null;
      if (!videoId || !state) continue;
      const [c] = await deps.streams.candidates({ videoIds: [videoId] }, tx);
      if (!c || c.state !== 'rejected' || c.reason !== 'blacklisted' || !transition(c.state, state, 'revert', state).ok) continue;
      await deps.streams.saveCandidate(tx, { videoId, state, reason: null }, byOf(actor), now);
    }
    return;
  }
  const videoId = text(after.videoId) ?? unreadable();
  const [have] = await deps.streams.candidates({ videoIds: [videoId] }, tx);
  if (!have) unreadable();
  const state = (text(before.state) as CandidateState | null) ?? unreadable();
  if (have.state !== state && !transition(have.state, state, 'revert', state).ok) throw new Error('streams revert refused: invalid-state');
  if (entry.action === STREAMS_CANDIDATE_ACTION) {
    const foundBy = Array.isArray(before.foundBy) ? (before.foundBy as FoundBy[]) : have.foundBy;
    const next: StoredCandidate = { ...have, state, reason: (text(before.reason) as CandidateReason | null) ?? null, eventId: text(before.eventId), foundBy };
    await deps.streams.saveCandidate(tx, next, byOf(actor), now);
    await journalCandidate(deps, tx, actor, have, next, entry.id);
    return;
  }
  // live.approve (AC-19): the source leaves the chain, version + 1, one `live.changed`, the candidate's previous state.
  const sourceId = text(after.sourceId) ?? unreadable();
  const eventId = text(after.eventId) ?? unreadable();
  await deps.live.state(tx);
  await deps.streams.deleteSource(tx, sourceId);
  await deps.streams.saveCandidate(tx, { videoId, state, eventId: text(before.eventId), sourceId: null }, byOf(actor), now);
  const version = await deps.live.bumpVersion(tx);
  await deps.journal.append(tx, {
    actor,
    action: LIVE_APPROVE_ACTION,
    target: { collection: SOURCES, id: sourceId },
    at: now,
    before: { videoId, eventId, sourceId, state: have.state },
    after: { videoId, state, eventId: text(before.eventId), sourceId: null },
    revertOf: entry.id,
  });
  const payload: LiveChangedPayload = { version, eventIds: [eventId], hidden: [{ eventId, sourceId }] };
  await deps.publisher.publish(tx, LIVE_CHANGED_TOPIC, payload);
}

/**
 * The revert-handler rows of the stream sources (`live.approve`, `streams.blacklist`, `streams.candidate`): one step,
 * the reverting owner from the revert's transaction. Rows that created something or were themselves a revert read as
 * `changed-since` (nothing to restore).
 */
export function sourcesRevertHandlers(depsOf: () => Promise<SourcesDeps>, actorOf: (tx: Tx) => Actor): RevertHandler[] {
  return [LIVE_APPROVE_ACTION, STREAMS_BLACKLIST_ACTION, STREAMS_CANDIDATE_ACTION].map((key) => ({
    key,
    async current(tx: Tx, entry: StoredJournalEntry) {
      return currentOf(await depsOf(), tx, entry);
    },
    async revert(tx: Tx, entry: StoredJournalEntry) {
      await revertOne(await depsOf(), tx, entry, actorOf(tx));
    },
  }));
}
