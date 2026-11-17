/**
 * Catalog version (AC-67), ring 1. The version is the one rule of the shared contract
 * (`generatedAt` + `tzdbVersion`); this file adds how a change moves it.
 */
export { catalogVersionOf } from '@time2fest/contracts';
import { catalogVersionOf } from '@time2fest/contracts';

/** `generatedAt` of the catalog files: UTC, whole seconds, `Z` (e.g. `2026-11-02T16:12:35Z`). */
export function generatedAtOf(nowMs: number): string {
  return new Date(nowMs).toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/**
 * The season meta after a change at `nowMs`, and the version it makes. Strictly monotonic: the new
 * `generatedAt` is max(now, previous + 1 s), so two changes within a second still differ.
 */
export function bumpedMeta(
  season: { tzdbVersion: string; generatedAt?: string | null },
  nowMs: number,
): { generatedAt: string; version: string } {
  const previous = season.generatedAt ? Date.parse(season.generatedAt) : Number.NaN;
  const generatedAt = generatedAtOf(Number.isNaN(previous) ? nowMs : Math.max(nowMs, previous + 1000));
  return { generatedAt, version: catalogVersionOf({ generatedAt, tzdbVersion: season.tzdbVersion }) };
}
