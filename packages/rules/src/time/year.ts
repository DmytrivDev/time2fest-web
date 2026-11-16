import type { Ms } from './types';

/** Largest zone offset (+14 h, Kiribati) with margin: New Year midnight falls between 10:00 31.12 and 12:00 1.01 UTC. */
const LATEST_OFFSET_MS = 15 * 3_600_000;

/**
 * The year that arrived at a zone's midnight: the local date of `midnightMs` shifted by the zone offset. Without an
 * offset, +15 h from midnight is already 1 January for every zone from −12 to +14.
 */
export function arrivedYear(midnightMs: Ms, offsetMinutes?: number): number {
  return new Date(midnightMs + (offsetMinutes !== undefined ? offsetMinutes * 60_000 : LATEST_OFFSET_MS)).getUTCFullYear();
}
