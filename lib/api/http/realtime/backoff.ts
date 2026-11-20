/**
 * Reconnect pauses of the realtime transport (SPEC-08, AC-59, AC-60; П-RT rec. 5). Pure: the random source is passed in.
 * Full jitter keeps a crowd of tabs that lost the connection at the same moment from coming back at the same moment.
 */

export const RECONNECT_MIN_MS = 1_500;
export const RECONNECT_MAX_MS = 45_000;
export const REFUSAL_MIN_MS = 30_000;
export const REFUSAL_SPREAD_MS = 30_000;

/** Pause before reconnect attempt `n` (0-based): uniform in [1 500, min(45 000, 1 500·2ⁿ)] ms (AC-59). `random` ∈ [0, 1]. */
export function reconnectDelay(n: number, random: () => number): number {
  const ceiling = Math.min(RECONNECT_MAX_MS, RECONNECT_MIN_MS * 2 ** Math.min(Math.max(0, n), 31));
  return RECONNECT_MIN_MS + random() * (ceiling - RECONNECT_MIN_MS);
}

/** Pause after a refused handshake or token request (4xx): uniform in [30 000, 60 000] ms (AC-60). */
export function refusalDelay(random: () => number): number {
  return REFUSAL_MIN_MS + random() * REFUSAL_SPREAD_MS;
}
