/**
 * Which events can carry presence (SPEC-14 [П-4], AC-8, AC-28), ring 1, pure. One predicate for beats (an invalid
 * event is skipped) and claims (`not_found`/`unknown-event`): the event is in the catalog of the current season, its
 * slot is `midnight` (a row without a slot is a midnight event, as in the scheduler's moment source), it is not
 * hidden after the corrections, and its effective moment is a finite number.
 */

const MIDNIGHT_SLOT = 'midnight';

/** An event row of the stored catalog (only the fields read here). */
export interface CatalogEventRow {
  readonly eventId?: unknown;
  readonly slot?: unknown;
  readonly hidden?: unknown;
}

/** An event with its correction applied (`momentsWithPatches`). */
export interface PatchedEvent {
  readonly eventId: string;
  readonly countryIso: string;
  readonly zoneId: string;
  readonly moment: number;
  readonly hidden: boolean;
}

export interface PresenceEvent {
  readonly eventId: string;
  readonly countryIso: string;
  readonly zoneId: string;
  /** The effective moment (correction applied). */
  readonly momentMs: number;
}

export interface PresenceCatalog {
  /** Season key (`2026-27`); empty when the catalog has no season. */
  readonly season: string;
  readonly events: ReadonlyMap<string, PresenceEvent>;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : v === null || v === undefined ? '' : String(v));

/** The valid presence events of the season: catalog rows joined with their effective moments and flags. */
export function presenceCatalogOf(season: string | null, rows: readonly CatalogEventRow[], patched: readonly PatchedEvent[]): PresenceCatalog {
  const events = new Map<string, PresenceEvent>();
  if (!season) return { season: '', events };
  const byId = new Map(rows.map((r) => [str(r.eventId), r]));
  for (const e of patched) {
    const row = byId.get(e.eventId);
    if (!row) continue;
    if ((str(row.slot) || MIDNIGHT_SLOT) !== MIDNIGHT_SLOT) continue;
    if (e.hidden || row.hidden === true) continue;
    if (!Number.isFinite(e.moment)) continue;
    events.set(e.eventId, { eventId: e.eventId, countryIso: e.countryIso, zoneId: e.zoneId, momentMs: e.moment });
  }
  return { season, events };
}

/** The event when it can carry presence, else `null`. */
export function validEvent(catalog: PresenceCatalog, eventId: string): PresenceEvent | null {
  return catalog.events.get(eventId) ?? null;
}
