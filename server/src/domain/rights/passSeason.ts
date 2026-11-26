/**
 * Pass holiday (SPEC-11 W11, [П-6], FR-ID-15, AC-13 … AC-15, EC-12), ring 1: pure, injected `now`.
 * A season key is `YYYY-YY` (`2026-27`). The current key ends at `currentEndMs` (`T2F_SEASON_END`); every later key
 * ends one calendar year after the previous one (an earlier key one year before). A pass issued before the end of
 * the current holiday belongs to it; issued after — to the next one, and is active at once (open question 3).
 * A pass is active from its issue to the end of its holiday (not revoked, not erased).
 */

export interface SeasonCtx {
  /** The current season key (`2026-27`). */
  readonly currentKey: string;
  /** End of the current season in epoch ms. */
  readonly currentEndMs: number;
}

const KEY = /^(\d{4})-(\d{2})$/;

function startYear(key: string): number {
  const m = KEY.exec(key);
  if (!m?.[1]) throw new Error(`rights: season key ${JSON.stringify(key)} is not YYYY-YY`);
  return Number(m[1]);
}

function keyOf(year: number): string {
  return `${year}-${String((year + 1) % 100).padStart(2, '0')}`;
}

/** `2026-27` → `2027-28`. */
export function nextSeasonKey(key: string): string {
  return keyOf(startYear(key) + 1);
}

/** The season key whose holiday ends in the calendar year of `endMs` (`2027-01-15` → `2026-27`). */
export function seasonKeyOfEnd(endMs: number): string {
  return keyOf(new Date(endMs).getUTCFullYear() - 1);
}

/** End of the holiday of `key` in epoch ms: the current end shifted by whole calendar years. */
export function seasonEndMs(key: string, ctx: SeasonCtx): number {
  const shift = startYear(key) - startYear(ctx.currentKey);
  const end = new Date(ctx.currentEndMs);
  end.setUTCFullYear(end.getUTCFullYear() + shift);
  return end.getTime();
}

/** The earliest season (from the current one on) whose holiday has not ended at `atMs`. */
export function firstOpenSeason(atMs: number, ctx: SeasonCtx): string {
  let key = ctx.currentKey;
  // Bounded: one step per year past the current end.
  for (let i = 0; i < 1000 && seasonEndMs(key, ctx) <= atMs; i += 1) key = nextSeasonKey(key);
  return key;
}

/** The holiday a pass issued at `issuedAtMs` belongs to. */
export function passSeason(issuedAtMs: number, ctx: SeasonCtx): string {
  return firstOpenSeason(issuedAtMs, ctx);
}

export interface PassTimes {
  readonly season: string;
  readonly revokedAt?: number | null;
  readonly erasedAt?: number | null;
}

/** Active at `now`: not revoked, not erased, its holiday has not ended. */
export function isActive(pass: PassTimes, now: number, ctx: SeasonCtx): boolean {
  if (pass.revokedAt != null || pass.erasedAt != null) return false;
  return now < seasonEndMs(pass.season, ctx);
}
