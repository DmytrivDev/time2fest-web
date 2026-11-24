/**
 * Candidate rules of the stream sources queue (SPEC-21a [А1], [А6] … [А9], AC-8 … AC-11, AC-15, AC-17, AC-23,
 * AC-31, AC-46), ring 1 — pure: time and configuration are parameters, no I/O, no clock.
 */
import type { CandidateReason, CandidateState, FoundBy } from '@time2fest/contracts';
import { FOUND_BY } from '@time2fest/contracts';
import type { LiveConfig } from './config';
import type { LiveEvent } from './moment';

/** Who asks for a state change: the owner, the agent, the server (check, blacklist, source status, retention) or a journal revert. */
export type CandidateActor = 'owner' | 'agent' | 'server' | 'revert';

export type TransitionResult = { ok: true } | { ok: false; code: 'invalid-state' };

type Rule = readonly [from: readonly (CandidateState | null)[], to: readonly CandidateState[], actors: readonly CandidateActor[]];

/** The AC-8 table, row by row (the revert row is handled apart: it needs the previous state). */
const TABLE: readonly Rule[] = [
  [[null], ['new', 'proposed', 'rejected'], ['server']],
  [['new'], ['proposed'], ['agent', 'owner']],
  [['new', 'proposed'], ['approved', 'rejected'], ['owner']],
  [['new', 'proposed'], ['rejected'], ['server']],
  [['approved'], ['active', 'dead'], ['server']],
  [['active'], ['dead'], ['server']],
  [['rejected'], ['new'], ['owner']],
  [['approved', 'active', 'dead', 'rejected'], ['archive'], ['server']],
];

/**
 * May `actor` move a candidate from `from` (`null` = not in the queue yet) to `to`? A journal revert may return any
 * state but `archive` to the `previous` one recorded in the journal row; nothing else passes.
 */
export function transition(from: CandidateState | null, to: CandidateState, actor: CandidateActor, previous?: CandidateState | null): TransitionResult {
  if (actor === 'revert') {
    return from !== null && from !== 'archive' && previous != null && to === previous && to !== from ? { ok: true } : { ok: false, code: 'invalid-state' };
  }
  const allowed = TABLE.some(([f, t, a]) => f.includes(from) && t.includes(to) && a.includes(actor));
  return allowed ? { ok: true } : { ok: false, code: 'invalid-state' };
}

/** The `videos.list` fields of the cheap check ([А7]): no titles, thumbnails or statistics. */
export interface CheapCheckVideo {
  channelId?: string | null;
  privacyStatus?: string | null;
  embeddable?: boolean | null;
  liveBroadcastContent?: string | null;
}

export type CheapVerdict = { state: 'new' | 'proposed' } | { state: 'rejected'; reason: Exclude<CandidateReason, 'owner'> };

/**
 * The cheap check verdict (AC-3, AC-11), reasons in this order: not-found, blacklisted, private, not-embeddable,
 * not-live. A fit video is `proposed` when an event is given, else `new`. `video === null` = YouTube did not return it.
 */
export function cheapVerdict(video: CheapCheckVideo | null, blacklisted: ReadonlySet<string>, eventGiven: boolean): CheapVerdict {
  if (!video) return { state: 'rejected', reason: 'not-found' };
  if (video.channelId && blacklisted.has(video.channelId)) return { state: 'rejected', reason: 'blacklisted' };
  if (video.privacyStatus !== 'public') return { state: 'rejected', reason: 'private' };
  if (video.embeddable !== true) return { state: 'rejected', reason: 'not-embeddable' };
  if (video.liveBroadcastContent !== 'upcoming' && video.liveBroadcastContent !== 'live') return { state: 'rejected', reason: 'not-live' };
  return { state: eventGiven ? 'proposed' : 'new' };
}

/**
 * A known videoId added again (AC-9): the new origin joins the existing ones (in `FOUND_BY` order, no duplicates);
 * the state never changes here — a `rejected` candidate stays `rejected`.
 */
export function mergeOrigin<S extends CandidateState>(existing: { foundBy: readonly FoundBy[]; state: S }, foundBy: FoundBy): { foundBy: FoundBy[]; state: S; changed: boolean } {
  const set = new Set<FoundBy>([...existing.foundBy, foundBy]);
  const merged = FOUND_BY.filter((f) => set.has(f));
  return { foundBy: merged, state: existing.state, changed: !existing.foundBy.includes(foundBy) };
}

const AGENT_REACHABLE: ReadonlySet<CandidateState> = new Set<CandidateState>(['new', 'proposed', 'rejected']);

/** The agent never sets a candidate above `proposed` (AC-31). */
export function capForAgent(state: CandidateState): CandidateState {
  return AGENT_REACHABLE.has(state) ? state : 'proposed';
}

/** The agent's proposals of one quota day are within `agent.proposalsPerDay` ([А13]). */
export function agentProposalAllowed(usedToday: number, cfg: LiveConfig): boolean {
  return usedToday < cfg.agent.proposalsPerDay;
}

/**
 * The default event of an approval ([А8], AC-15): among the (not hidden) events of the channel's zones, the one whose
 * moment is nearest to `scheduledStart` within ±`defaultEventToleranceMs`; ties by eventId. `null` = the owner picks.
 */
export function defaultEvent(
  scheduledStart: number | null,
  channelZones: readonly string[],
  events: readonly Pick<LiveEvent, 'eventId' | 'zoneId' | 'moment' | 'hidden'>[],
  cfg: LiveConfig,
): string | null {
  if (scheduledStart == null || !Number.isFinite(scheduledStart)) return null;
  const zones = new Set(channelZones);
  let best: { eventId: string; d: number } | null = null;
  for (const e of events) {
    if (e.hidden || !zones.has(e.zoneId)) continue;
    const d = Math.abs(e.moment - scheduledStart);
    if (d > cfg.defaultEventToleranceMs) continue;
    if (!best || d < best.d || (d === best.d && e.eventId < best.eventId)) best = { eventId: e.eventId, d };
  }
  return best?.eventId ?? null;
}

/** The source fields the chain ceiling reads. */
export interface CeilingSource {
  videoId?: string | null;
  dead?: boolean | null;
  hidden?: boolean | null;
  override?: string | null;
}

/** Active sources of a chain ([А1]): with a videoId, not dead, not hidden (flag or `override: hidden`). */
export function activeSourceCount(sources: readonly CeilingSource[]): number {
  return sources.filter((s) => !!s.videoId && s.dead !== true && s.hidden !== true && s.override !== 'hidden').length;
}

/** Adding one more source would exceed `maxSourcesPerEvent` (AC-23 `chain-full`). */
export function chainFull(sources: readonly CeilingSource[], cfg: LiveConfig): boolean {
  return activeSourceCount(sources) >= cfg.maxSourcesPerEvent;
}

/** The candidate's YouTube fields are fresh enough to be written into the source on approve ([А9], AC-17). */
export function checkIsFresh(ytFetchedAt: number | null | undefined, now: number, cfg: LiveConfig): boolean {
  return ytFetchedAt != null && now - ytFetchedAt <= cfg.candidateFreshMs;
}

/**
 * The candidate follows its approved source (AC-10): `approved` → `active` on the first `live`, `approved`/`active`
 * → `dead` when the source dies. `null` = no change.
 */
export function candidateOnSourceStatus(state: CandidateState, sourceLive: boolean, sourceDead: boolean): CandidateState | null {
  if (sourceDead && (state === 'approved' || state === 'active')) return 'dead';
  if (sourceLive && state === 'approved') return 'active';
  return null;
}

/** A candidate as the retention pass reads it (times as epoch ms). */
export interface RetentionCandidate {
  videoId: string;
  state: CandidateState;
  /** When the YouTube fields were fetched; `null` = none kept. */
  ytFetchedAt: number | null;
  stateChangedAt: number;
}

export interface RetentionPlan {
  /** `videos.list` again: fields older than `candidateRefreshMs` of a live-queue candidate. */
  refresh: string[];
  /** Clear the YouTube fields, keep ours (videoId, channelId, origin, state, reason, decision time). */
  strip: string[];
  /** Move to `archive`. */
  archive: string[];
}

const REFRESHED: ReadonlySet<CandidateState> = new Set<CandidateState>(['new', 'proposed', 'approved', 'active']);
const ARCHIVABLE: ReadonlySet<CandidateState> = new Set<CandidateState>(['approved', 'active', 'dead', 'rejected']);
const STRIPPED: ReadonlySet<CandidateState> = new Set<CandidateState>(['rejected', 'dead', 'archive']);

/** The daily retention plan (AC-46). Each videoId lands in at most one of refresh / strip; archive implies strip. */
export function retentionPlan(candidates: readonly RetentionCandidate[], now: number, cfg: LiveConfig): RetentionPlan {
  const plan: RetentionPlan = { refresh: [], strip: [], archive: [] };
  for (const c of candidates) {
    const archive = ARCHIVABLE.has(c.state) && now - c.stateChangedAt >= cfg.candidateArchiveMs;
    if (archive) plan.archive.push(c.videoId);
    const hasFields = c.ytFetchedAt != null;
    if (hasFields && (archive || STRIPPED.has(c.state))) plan.strip.push(c.videoId);
    else if (hasFields && REFRESHED.has(c.state) && now - (c.ytFetchedAt as number) >= cfg.candidateRefreshMs) plan.refresh.push(c.videoId);
  }
  return plan;
}
