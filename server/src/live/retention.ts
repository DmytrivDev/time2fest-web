/**
 * The 30-day retention of YouTube fields (SPEC-12 AC-73, AC-74), ring 3 — runs every `RETENTION_RUN_MS` inside the
 * poller tick, under the poller lease.
 *
 * Every source whose `ytFetchedAt` is older than `retentionMs` minus a margin (one day, at most half the period) gets
 * one `videos.list` refresh, so with a run every 6 h no YouTube field outlives `retentionMs` (security S12-03). The
 * refresh is counted, class `off-window`, so it waits below the reserve. A refreshed source takes the normal check result; one that could not be
 * refreshed (refused, failed) loses every YouTube field and `ytFetchedAt`, so the public chain drops it (AC-74) until
 * a check succeeds. Nothing here writes a journal row: the only rows of the wave carry our own fields.
 */
import { retentionPlan, type RetentionCandidate, type RetentionPlan } from '../domain/live/candidates';
import type { LiveConfig } from '../domain/live/config';
import { nextOffWindowCheckAt } from '../domain/live/schedule';
import type { YoutubeVideoState } from '../domain/live/status';
import type { LiveSource, SourceCheck } from './ports';

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
/** How often the poller runs the retention pass; well inside the refresh margin. */
export const RETENTION_RUN_MS = 6 * HOUR_MS;

/** The fetch age from which a source is refreshed: `retentionMs` minus one day (at most half the period). */
export function retentionRefreshAgeMs(cfg: LiveConfig): number {
  return cfg.retentionMs - Math.min(DAY_MS, Math.floor(cfg.retentionMs / 2));
}

/** Sources with a YouTube fetch older than the refresh age, not among `skip` (checked in this tick). */
export function expiredSources(sources: readonly LiveSource[], now: number, cfg: LiveConfig, skip: ReadonlySet<string> = new Set()): LiveSource[] {
  const age = retentionRefreshAgeMs(cfg);
  return sources.filter((s) => s.ytFetchedAt != null && now - s.ytFetchedAt > age && !skip.has(s.sourceId));
}

/** Clears every YouTube field of a source; the next off-window check is on the usual grid (AC-26). */
export function clearedCheck(source: LiveSource, now: number, cfg: LiveConfig): SourceCheck {
  return { sourceId: source.sourceId, youtube: null, nextOffWindowCheckAt: nextOffWindowCheckAt(now, cfg) };
}

/**
 * Answers of the refresh: the ids it asked successfully, each with its item (`undefined` = absent from the answer).
 * An id not in the map was not refreshed.
 */
export type Refreshed = ReadonlyMap<string, YoutubeVideoState | undefined>;

export interface RetentionRun {
  checks: SourceCheck[];
  refreshed: number;
  cleared: number;
}

/** The writes of one retention pass. `checkOf` maps a refreshed source exactly like a poller check. */
export async function runRetention(
  expired: readonly LiveSource[],
  now: number,
  cfg: LiveConfig,
  refresh: (videoIds: readonly string[]) => Promise<Refreshed>,
  checkOf: (source: LiveSource, item: YoutubeVideoState | undefined) => SourceCheck,
): Promise<RetentionRun> {
  if (expired.length === 0) return { checks: [], refreshed: 0, cleared: 0 };
  const ids = [...new Set(expired.map((s) => s.videoId).filter((id): id is string => !!id))];
  const answers = ids.length ? await refresh(ids) : new Map<string, YoutubeVideoState | undefined>();
  const run: RetentionRun = { checks: [], refreshed: 0, cleared: 0 };
  for (const s of expired) {
    if (s.videoId && answers.has(s.videoId)) {
      run.checks.push(checkOf(s, answers.get(s.videoId)));
      run.refreshed += 1;
    } else {
      run.checks.push(clearedCheck(s, now, cfg));
      run.cleared += 1;
    }
  }
  return run;
}

// ---- candidates (SPEC-21a AC-46) ----

/**
 * The candidate retention plan of one pass (AC-46), run by the sources watch on the same 6 h grid: live-queue
 * candidates are refreshed a margin before `candidateRefreshMs` (as the sources above), so no YouTube field of a
 * candidate outlives it between passes; decided ones lose their YouTube fields; unchanged decided ones are archived.
 */
export function candidateRetentionPlan(candidates: readonly RetentionCandidate[], now: number, cfg: LiveConfig): RetentionPlan {
  const margin = Math.min(DAY_MS, Math.floor(cfg.candidateRefreshMs / 2));
  return retentionPlan(candidates, now, { ...cfg, candidateRefreshMs: cfg.candidateRefreshMs - margin });
}

/** The YouTube fields of a candidate, cleared (our fields — videoId, channelId, origin, state, reason, decision — stay). */
export const CLEARED_CANDIDATE_FIELDS = Object.freeze({
  liveBroadcastContent: null,
  scheduledStartTime: null,
  embeddable: null,
  privacyStatus: null,
  ytFetchedAt: null,
});

export interface CandidateRetentionRun {
  /** Refreshed with an answer: the video as YouTube returned it now. */
  refreshed: Map<string, YoutubeVideoState>;
  /** Fields cleared: decided candidates, and live-queue ones that could not be refreshed or are gone. */
  strip: string[];
  archive: string[];
}

/**
 * Runs the plan's refresh through `refresh` (one counted `videos.list` per batch, class `candidates`); a live-queue
 * candidate not answered (refused, failed, gone) loses its YouTube fields so they never outlive the limit.
 */
export async function runCandidateRetention(
  candidates: readonly RetentionCandidate[],
  now: number,
  cfg: LiveConfig,
  refresh: (videoIds: readonly string[]) => Promise<Refreshed>,
): Promise<CandidateRetentionRun> {
  const plan = candidateRetentionPlan(candidates, now, cfg);
  const answers = plan.refresh.length ? await refresh(plan.refresh) : new Map<string, YoutubeVideoState | undefined>();
  const run: CandidateRetentionRun = { refreshed: new Map(), strip: [...plan.strip], archive: [...plan.archive] };
  for (const id of plan.refresh) {
    const item = answers.get(id);
    if (item) run.refreshed.set(id, item);
    else run.strip.push(id);
  }
  return run;
}
