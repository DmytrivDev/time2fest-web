/**
 * When the client should send its next presence beat (SPEC-14 [А2], AC-2, AC-8), ring 1, pure. Relative to the
 * nearest moment among the beat's valid events that still accepts presence (`now ≤ stampAcceptUntil(m, Δ)`):
 * - more than 5 min before it — the time until "m − 5 min", at most 15 min;
 * - from 5 min to 2 min before — 60 s;
 * - from 2 min before to m + 15 s + Δ — I (`PULSE_INTERVAL_MS`);
 * - after m + 15 s + Δ for every event (or no valid event) — `null`.
 * The client's own clock fields never enter: `now` is the server clock (NFR-8).
 */
import { PULSE_INTERVAL_MS, stampAcceptUntil } from '@time2fest/rules/time';
import { PRESENCE_DELTA_MS } from './window';

/** Longest pause between two beats far from midnight. */
export const BEAT_MAX_PAUSE_MS = 900_000;
/** Beats switch from "until m − 5 min" to every 60 s this long before the moment. */
export const BEAT_NEAR_LEAD_MS = 300_000;
/** The beat interval between 5 and 2 min before the moment. */
export const BEAT_NEAR_INTERVAL_MS = 60_000;
/** Beats switch to every I this long before the moment. */
export const BEAT_CLOSE_LEAD_MS = 120_000;

export function nextBeatMs(now: number, moments: readonly number[]): number | null {
  let nearest: number | null = null;
  for (const moment of moments) {
    if (!Number.isFinite(moment) || now > stampAcceptUntil(moment, PRESENCE_DELTA_MS)) continue;
    if (nearest === null || moment < nearest) nearest = moment;
  }
  if (nearest === null) return null;
  const lead = nearest - now;
  if (lead <= BEAT_CLOSE_LEAD_MS) return PULSE_INTERVAL_MS;
  if (lead <= BEAT_NEAR_LEAD_MS) return BEAT_NEAR_INTERVAL_MS;
  return Math.min(lead - BEAT_NEAR_LEAD_MS, BEAT_MAX_PAUSE_MS);
}
