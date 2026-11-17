/**
 * Kyiv wall-clock input of sleep windows (AC-31, owner decision Q5), ring 1 — pure.
 *
 * `kyivLocalToUtc('YYYY-MM-DDTHH:mm')` gives the UTC instant of a `Europe/Kyiv` wall-clock time,
 * probing the zone offset with `Intl.DateTimeFormat` (Node's ICU data). Daylight-saving edges follow
 * the "compatible" rule:
 * - a wall time skipped by the spring change (03:00–03:59 on the last Sunday of March) is read with
 *   the offset before the change, so it lands after the change (03:30 → 01:30Z = 04:30 summer time);
 * - a wall time repeated by the autumn change (03:00–03:59 on the last Sunday of October) takes the
 *   earlier of the two instants (summer time).
 * A different Q5 answer (a recurring schedule) changes this file and `override.ts` only.
 */

export const KYIV_ZONE = 'Europe/Kyiv';
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const DAY_MS = 86_400_000;

const formatter = new Intl.DateTimeFormat('en-US', {
  timeZone: KYIV_ZONE,
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
});

/** The Kyiv wall clock at `ms`, read as if it were UTC (epoch ms). */
function wallAsUtc(ms: number): number {
  const parts: Record<string, number> = {};
  for (const p of formatter.formatToParts(new Date(ms))) {
    if (p.type !== 'literal') parts[p.type] = Number(p.value);
  }
  return Date.UTC(parts.year ?? 0, (parts.month ?? 1) - 1, parts.day ?? 1, parts.hour ?? 0, parts.minute ?? 0, parts.second ?? 0);
}

/** The Kyiv offset from UTC at instant `ms`, in ms (e.g. +2 h in winter). */
function offsetAt(ms: number): number {
  const whole = Math.floor(ms / 1000) * 1000;
  return wallAsUtc(whole) - whole;
}

/** The fields of `YYYY-MM-DDTHH:mm` as a UTC epoch, or `null` when the text is not a real date-time. */
function parseLocal(text: string): number | null {
  const m = LOCAL.exec(text);
  if (!m) return null;
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number];
  if (mo < 1 || mo > 12 || d < 1 || h > 23 || mi > 59) return null;
  const ms = Date.UTC(y, mo - 1, d, h, mi);
  const back = new Date(ms);
  return back.getUTCFullYear() === y && back.getUTCMonth() === mo - 1 && back.getUTCDate() === d ? ms : null;
}

/** The UTC instant (epoch ms) of a Kyiv wall-clock time `YYYY-MM-DDTHH:mm`, or `null` for malformed input. */
export function kyivLocalToUtc(text: string): number | null {
  if (typeof text !== 'string') return null;
  const local = parseLocal(text);
  if (local === null) return null;
  const before = offsetAt(local - DAY_MS);
  const after = offsetAt(local + DAY_MS);
  if (before === after) return local - before;
  const valid = [local - after, local - before].filter((t) => wallAsUtc(t) === local).sort((a, b) => a - b);
  // Repeated wall time → the earlier instant; skipped wall time → read with the offset before the change.
  return valid[0] ?? local - before;
}

/** The Kyiv wall-clock time of a UTC instant as `YYYY-MM-DDTHH:mm` (for display and round trips). */
export function utcToKyivLocal(ms: number): string {
  return new Date(wallAsUtc(ms)).toISOString().slice(0, 16);
}
