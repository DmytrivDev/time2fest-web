/**
 * Passport achievements and streaks (SPEC-14 [А11], AC-41, AC-42). One pure function: the server calls it on grant,
 * the site (SPEC-19) later. The rule mirrors `lib/api/sim/NotificationsGenerator.tsx`: countries 3/5/10 (distinct
 * `countryIso`), zones 3/5/10 (distinct event zones), streak 3/5 (a run of adjacent catalog zone orders that ends at
 * the highest order among the stamps). No data import: the zone order comes in as a function.
 */

export interface AchievementStamp {
  readonly eventId: string;
  readonly countryIso: string;
  readonly zoneId: string;
}

export type AchievementSeason = string | number;

export const COUNTRY_GOALS = [3, 5, 10] as const;
export const ZONE_GOALS = [3, 5, 10] as const;
export const STREAK_GOALS = [3, 5] as const;

/** Length of the run of adjacent zone orders that ends at the highest order (0 when there are no known orders). */
export function streakLength(stamps: readonly AchievementStamp[], zoneOrder: (zoneId: string) => number): number {
  const orders = [...new Set(stamps.map((s) => zoneOrder(s.zoneId)).filter((o) => Number.isFinite(o)))].sort((a, b) => a - b);
  if (orders.length === 0) return 0;
  let run = 1;
  for (let i = orders.length - 1; i > 0; i -= 1) {
    if (orders[i]! - orders[i - 1]! === 1) run += 1;
    else break;
  }
  return run;
}

/** Sorted keys reached: `goal:<season>:countries:<n>`, `goal:<season>:zones:<n>`, `streak:<season>:<n>`. */
export function achievementsOf(
  stamps: readonly AchievementStamp[],
  zoneOrder: (zoneId: string) => number,
  season: AchievementSeason,
): string[] {
  const countries = new Set(stamps.map((s) => s.countryIso)).size;
  const zones = new Set(stamps.map((s) => s.zoneId).filter(Boolean)).size;
  const run = streakLength(stamps, zoneOrder);
  const keys: string[] = [];
  for (const g of COUNTRY_GOALS) if (countries >= g) keys.push(`goal:${season}:countries:${g}`);
  for (const g of ZONE_GOALS) if (zones >= g) keys.push(`goal:${season}:zones:${g}`);
  for (const g of STREAK_GOALS) if (run >= g) keys.push(`streak:${season}:${g}`);
  return keys.sort();
}
