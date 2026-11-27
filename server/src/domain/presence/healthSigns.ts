/**
 * Health of one presence window (SPEC-14 [А4], [А5], [П-5]; AC-15 … AC-17, AC-21), ring 1, pure.
 * `healthOf` turns the intake samples of the nodes, the window's distinct-subject counters and the downtime records
 * into `healthy` or `downtime` with every sign found. Incomplete data never reads as healthy: no samples → `sample-gap`,
 * no counters → `beat-rate-drop`. Time is passed in; nothing here reads a clock.
 */
import { PRE_WINDOW_LEAD_MS, windowOf } from './window';

/** Cadence of the intake sampler of every node. */
export const SAMPLE_INTERVAL_MS = 5_000;
/** A gap between two samples of a live node longer than this is a `sample-gap` ([А5]). */
export const SAMPLE_GAP_MS = 10_000;
/** A window is finalised once its end + this grace has passed (AC-15). */
export const FINALISE_GRACE_MS = 10_000;
/** No record after the window end + this span → the window counts as downtime for claims (AC-18). */
export const MISSING_RECORD_MS = 120_000;
/** `beat-errors`: failed beats above this share of all beats in the window ([А5]). */
export const BEAT_ERROR_SHARE = 0.01;
/**
 * `beat-rate-drop` applies only when at least this many ESTABLISHED subjects beat before the window (AC-17, S14-01:
 * raised from 20 so a handful of throwaway guests cannot switch a window to downtime).
 */
export const RATE_DROP_MIN_PRE = 50;
/** A subject is established for a window when it was created at least this long before the window start (S14-01). */
export const ESTABLISHED_SUBJECT_AGE_MS = 3_600_000;
/** A downtime alarms when it overlaps `[m − span; m + span]` of any event (AC-20). */
export const DOWNTIME_ALARM_SPAN_MS = 600_000;

/** The signs of [А5], in report order. */
export const HEALTH_SIGNS = [
  'fast-store-unavailable',
  'fast-store-restart',
  'sample-gap',
  'beat-errors',
  'beat-rate-drop',
  'edge-region',
  'manual',
] as const;
export type HealthSign = (typeof HEALTH_SIGNS)[number];
export type HealthState = 'healthy' | 'downtime';

/** One intake sample of one node (no subject data). */
export interface HealthSample {
  readonly nodeId: string;
  readonly at: number;
  readonly fastReachable: boolean;
  readonly fastRunId: string | null;
  readonly fastUptimeS: number | null;
  /** Beats accepted / failed since the node's previous sample. */
  readonly accepted: number;
  readonly failed: number;
}

/** A manual or edge-region downtime record. */
export interface HealthDowntime {
  readonly kind: 'manual' | 'edge-region';
  /** A manual record of one event; `null` = a time range. */
  readonly eventId: string | null;
  readonly from: number;
  readonly to: number;
}

export interface HealthInput {
  readonly eventId: string;
  readonly moment: number;
  /** Samples of every node around the window (`samplesSpanOf`); others are ignored. */
  readonly samples: readonly HealthSample[];
  /** Distinct subjects before the window and inside it; `null` when the counters could not be read. */
  readonly counters: { readonly pre: number; readonly in: number } | null;
  readonly downtimes: readonly HealthDowntime[];
}

export interface HealthVerdict {
  readonly state: HealthState;
  readonly signs: readonly HealthSign[];
}

/** Closed intervals overlap. */
export const overlaps = (aFrom: number, aTo: number, bFrom: number, bTo: number): boolean => aFrom <= bTo && bFrom <= aTo;

/** When the window of `moment` is due for its record. */
export const finaliseDueAt = (moment: number): number => windowOf(moment).until + FINALISE_GRACE_MS;

/** When a missing record makes the window a downtime for claims (AC-18). */
export const missingRecordAt = (moment: number): number => windowOf(moment).until + MISSING_RECORD_MS;

/** Where the counters of the window start (the pre-window span, AC-17): a fast-store start after it lost them. */
export const countingStartOf = (moment: number): number => moment - PRE_WINDOW_LEAD_MS;

/** The sample span `healthOf` reads for `moment`: from the counting start − gap to the window end + interval + gap. */
export function samplesSpanOf(moment: number): { from: number; to: number } {
  return { from: countingStartOf(moment) - SAMPLE_GAP_MS, to: windowOf(moment).until + SAMPLE_INTERVAL_MS + SAMPLE_GAP_MS };
}

/**
 * Whether a subject created at `createdAt` counts for the `beat-rate-drop` sign of `moment` (S14-01): created at
 * least `ESTABLISHED_SUBJECT_AGE_MS` before the window start. Unknown creation time → not established.
 */
export function isEstablishedFor(createdAt: number | null, moment: number): boolean {
  return createdAt !== null && Number.isFinite(createdAt) && createdAt <= windowOf(moment).from - ESTABLISHED_SUBJECT_AGE_MS;
}

/** Whether a downtime record applies to the window of `eventId` at `moment`. */
export function downtimeApplies(d: HealthDowntime, eventId: string, moment: number): boolean {
  if (d.kind === 'manual' && d.eventId !== null) return d.eventId === eventId;
  const w = windowOf(moment);
  return overlaps(d.from, d.to, w.from, w.until);
}

/**
 * `sample-gap` (W3): a node is judged when it has a sample anywhere in the counting span `[countStart; until]` — a
 * node live before the window that stops sampling inside it (crash, restart under a new per-boot id, deploy) is a gap.
 * Inside the window `[from; until]` every judged node must sample at most `SAMPLE_GAP_MS` apart; no judged node → gap.
 */
function sampleGap(samples: readonly HealthSample[], countStart: number, from: number, until: number): boolean {
  const byNode = new Map<string, number[]>();
  for (const s of samples) {
    let list = byNode.get(s.nodeId);
    if (!list) byNode.set(s.nodeId, (list = []));
    list.push(s.at);
  }
  let live = 0;
  for (const ats of byNode.values()) {
    // Live = at least one sample in the counting span; a node gone before the counting start is not judged.
    if (!ats.some((t) => t >= countStart && t <= until)) continue;
    live += 1;
    const points = ats.filter((t) => t >= from - SAMPLE_GAP_MS && t <= until + SAMPLE_GAP_MS).sort((a, b) => a - b);
    let prev = from;
    for (const t of points) {
      if (t - prev > SAMPLE_GAP_MS) return true;
      prev = Math.max(prev, t);
    }
    if (until - prev > SAMPLE_GAP_MS) return true;
  }
  return live === 0;
}

/** The record of one window ([А5]). */
export function healthOf(input: HealthInput): HealthVerdict {
  const w = windowOf(input.moment);
  const countStart = countingStartOf(input.moment);
  // A sample's counters cover the span since the node's previous sample, so the window's beats reach one interval past it.
  const inWin = input.samples.filter((s) => s.at >= w.from && s.at <= w.until + SAMPLE_INTERVAL_MS);
  const counting = input.samples.filter((s) => s.at >= countStart && s.at <= w.until + SAMPLE_INTERVAL_MS);
  const signs = new Set<HealthSign>();

  if (inWin.some((s) => !s.fastReachable)) signs.add('fast-store-unavailable');

  const runIds = new Set(counting.map((s) => s.fastRunId).filter((r): r is string => r !== null && r !== ''));
  const restartedInSpan = counting.some((s) => s.fastUptimeS !== null && s.fastUptimeS * 1_000 < s.at - countStart);
  if (runIds.size > 1 || restartedInSpan) signs.add('fast-store-restart');

  if (sampleGap(input.samples, countStart, w.from, w.until)) signs.add('sample-gap');

  let accepted = 0;
  let failed = 0;
  for (const s of inWin) {
    accepted += s.accepted;
    failed += s.failed;
  }
  const total = accepted + failed;
  if (total > 0 && failed / total > BEAT_ERROR_SHARE) signs.add('beat-errors');

  const c = input.counters;
  if (c === null || (c.pre >= RATE_DROP_MIN_PRE && c.in * 2 < c.pre)) signs.add('beat-rate-drop');

  for (const d of input.downtimes) {
    if (downtimeApplies(d, input.eventId, input.moment)) signs.add(d.kind === 'manual' ? 'manual' : 'edge-region');
  }

  const ordered = HEALTH_SIGNS.filter((s) => signs.has(s));
  return { state: ordered.length > 0 ? 'downtime' : 'healthy', signs: ordered };
}
