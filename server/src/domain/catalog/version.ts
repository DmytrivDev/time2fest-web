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

/** The season meta after a change at `nowMs`, and the version it makes. */
export function bumpedMeta(season: { tzdbVersion: string }, nowMs: number): { generatedAt: string; version: string } {
  const generatedAt = generatedAtOf(nowMs);
  return { generatedAt, version: catalogVersionOf({ generatedAt, tzdbVersion: season.tzdbVersion }) };
}
