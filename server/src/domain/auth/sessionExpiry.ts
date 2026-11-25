/**
 * Session expiry (SPEC-10 W13, AC-26, EC-9), ring 1: pure, injected `now`.
 * Before the season end a session lives `min(now + 60 days, season end)`; from the season end on, `now + 60 days`.
 */

export const SESSION_TTL_MS = 60 * 24 * 60 * 60 * 1000;

/** Expiry in epoch ms for a session created or refreshed at `now` (epoch ms). */
export function sessionExpiresAt(now: number, seasonEnd: number): number {
  const full = now + SESSION_TTL_MS;
  return now < seasonEnd ? Math.min(full, seasonEnd) : full;
}
