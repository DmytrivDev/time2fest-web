/**
 * What the status poller checks in one tick (SPEC-12 AC-25, AC-26, NFR-1), ring 1 — pure, time is a parameter.
 *
 * - Open windows: the distinct videoIds of every not hidden event whose window is open, in one merged cycle,
 *   batched by B, so a tick makes exactly ⌈A/B⌉ calls (AC-25).
 * - Off-window: a videoId outside every open window is due when its `nextOffWindowCheckAt` has come (or it was
 *   never checked). The next time is the first point of a grid of step `offWindowMin` (from the epoch) at or after
 *   `lastChecked + offWindowMin`, capped by `lastChecked + offWindowMax` — so the interval is in
 *   [offWindowMin, offWindowMax] (AC-26) and all off-window ids fall due together, which keeps their calls at
 *   ⌈N/B⌉ per grid point (the `R` term of NFR-1).
 */
import type { LiveConfig } from './config';
import { openWindowEvents, type LiveEvent } from './moment';

export interface ScheduledSource {
  eventId: string;
  videoId: string;
  /** Epoch ms; `null` = never checked off-window (due now). */
  nextOffWindowCheckAt?: number | null;
}

export interface TickPlan {
  /** Distinct ids of the open windows (A). */
  windowIds: string[];
  /** Distinct ids due for an off-window check, none of them in `windowIds`. */
  offWindowIds: string[];
  /** `videos.list` calls of the tick: window batches first, then off-window ones. */
  batches: string[][];
}

/** Splits ids into consecutive batches of at most `size`. */
export function batchesOf(ids: readonly string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

/** The distinct videoIds of the open windows, in event then source order. */
export function openWindowIds(events: readonly LiveEvent[], sources: readonly ScheduledSource[], now: number, cfg: LiveConfig): string[] {
  const open = new Set(openWindowEvents(events, now, cfg).map((e) => e.eventId));
  const ids = new Set<string>();
  for (const s of sources) if (open.has(s.eventId) && s.videoId) ids.add(s.videoId);
  return [...ids];
}

/** The tick's calls (AC-25) plus the due off-window checks (AC-26). Sources of hidden events are never asked (AC-10). */
export function planTick(events: readonly LiveEvent[], sources: readonly ScheduledSource[], now: number, cfg: LiveConfig): TickPlan {
  const windowIds = openWindowIds(events, sources, now, cfg);
  const inWindow = new Set(windowIds);
  const hidden = new Set(events.filter((e) => e.hidden).map((e) => e.eventId));
  const due = new Set<string>();
  for (const s of sources) {
    if (!s.videoId || inWindow.has(s.videoId) || hidden.has(s.eventId)) continue;
    if (s.nextOffWindowCheckAt == null || s.nextOffWindowCheckAt <= now) due.add(s.videoId);
  }
  // An id shared with a hidden event's source but due through a visible one stays due; one asked only by hidden
  // events never is.
  const offWindowIds = [...due];
  return {
    windowIds,
    offWindowIds,
    batches: [...batchesOf(windowIds, cfg.batchSize), ...batchesOf(offWindowIds, cfg.batchSize)],
  };
}

/** When a source checked at `checkedAt` (in or out of a window) is next due off-window. */
export function nextOffWindowCheckAt(checkedAt: number, cfg: LiveConfig): number {
  const step = cfg.offWindowMinMs;
  const earliest = checkedAt + step;
  const onGrid = Math.ceil(earliest / step) * step;
  return Math.min(onGrid, checkedAt + cfg.offWindowMaxMs);
}

/** Units of a tick plan. */
export function unitsOf(plan: TickPlan, cfg: LiveConfig): number {
  return plan.batches.length * cfg.unitsPerListCall;
}
