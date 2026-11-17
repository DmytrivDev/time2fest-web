/**
 * Catalog integrity rules (AC-49), ring 1: pure, no I/O. Relations are text natural keys.
 *
 * `checkCatalog` lists every broken rule of a snapshot; `applyChange` overlays a pending write on a
 * snapshot; `newViolations` keeps only what the change introduced, so a record can still be fixed
 * in a catalog that is already broken elsewhere.
 */
export type CatalogKind = 'zones' | 'countries' | 'cities' | 'events';

export const CATALOG_RULES = [
  'event-zone-missing',
  'event-city-missing',
  'event-country-missing',
  'city-zone-mismatch',
  'pair-main-count',
] as const;
export type CatalogRule = (typeof CATALOG_RULES)[number];

export interface CatalogSnapshot {
  zones: { zoneId: string }[];
  countries: { iso: string }[];
  cities: { cityId: string; zoneId: string; countryIso: string }[];
  events: {
    eventId: string;
    cityId: string;
    zoneId: string;
    countryIso: string;
    isMainCelebration: boolean;
    /** Hidden by a correction; absent until the corrections exist. */
    hidden?: boolean;
  }[];
}

export interface Violation {
  rule: CatalogRule;
  ids: string[];
}

/** The key field of each kind. */
export const KEY_FIELD: Readonly<Record<CatalogKind, string>> = {
  zones: 'zoneId',
  countries: 'iso',
  cities: 'cityId',
  events: 'eventId',
};

export function checkCatalog(s: CatalogSnapshot): Violation[] {
  const out: Violation[] = [];
  const zones = new Set(s.zones.map((z) => z.zoneId));
  const countries = new Set(s.countries.map((c) => c.iso));
  const cities = new Map(s.cities.map((c) => [c.cityId, c]));
  for (const e of s.events) {
    if (!zones.has(e.zoneId)) out.push({ rule: 'event-zone-missing', ids: [e.eventId, e.zoneId] });
    const city = cities.get(e.cityId);
    if (!city) out.push({ rule: 'event-city-missing', ids: [e.eventId, e.cityId] });
    if (!countries.has(e.countryIso)) out.push({ rule: 'event-country-missing', ids: [e.eventId, e.countryIso] });
    if (city && city.zoneId !== e.zoneId) out.push({ rule: 'city-zone-mismatch', ids: [e.eventId, e.cityId] });
  }
  const pairs = new Map<string, { country: string; zone: string; visible: number; mains: number }>();
  for (const e of s.events) {
    const key = `${e.countryIso}|${e.zoneId}`;
    const pair = pairs.get(key) ?? { country: e.countryIso, zone: e.zoneId, visible: 0, mains: 0 };
    if (!e.hidden) {
      pair.visible += 1;
      if (e.isMainCelebration) pair.mains += 1;
    }
    pairs.set(key, pair);
  }
  for (const p of pairs.values()) {
    // A pair whose every event is hidden is exempt.
    if (p.visible > 0 && p.mains !== 1) out.push({ rule: 'pair-main-count', ids: [p.country, p.zone] });
  }
  return out;
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v));

/** The snapshot row of a raw record (a stored document or a pending write). */
export function toSnapshotRow<K extends CatalogKind>(kind: K, raw: Record<string, unknown>): CatalogSnapshot[K][number] {
  const row = (() => {
    switch (kind) {
      case 'zones':
        return { zoneId: text(raw.zoneId) };
      case 'countries':
        return { iso: text(raw.iso) };
      case 'cities':
        return { cityId: text(raw.cityId), zoneId: text(raw.zoneId), countryIso: text(raw.countryIso) };
      case 'events':
        return {
          eventId: text(raw.eventId),
          cityId: text(raw.cityId),
          zoneId: text(raw.zoneId),
          countryIso: text(raw.countryIso),
          isMainCelebration: raw.isMainCelebration === true,
          ...(raw.hidden === true ? { hidden: true } : {}),
        };
    }
  })();
  return row as CatalogSnapshot[K][number];
}

export interface CatalogChange {
  kind: CatalogKind;
  /** The key the record had before the write (absent on create). */
  previousKey?: string;
  /** The record as it will be stored. */
  row: Record<string, unknown>;
}

/** The snapshot as it would be after the write. */
export function applyChange(s: CatalogSnapshot, change: CatalogChange): CatalogSnapshot {
  const field = KEY_FIELD[change.kind];
  const next = toSnapshotRow(change.kind, change.row) as Record<string, unknown>;
  const drop = new Set([change.previousKey, text(next[field])].filter((k): k is string => k !== undefined));
  const kept = (s[change.kind] as Record<string, unknown>[]).filter((r) => !drop.has(text(r[field])));
  return { ...s, [change.kind]: [...kept, next] } as CatalogSnapshot;
}

const idOf = (v: Violation): string => `${v.rule}|${v.ids.join('|')}`;

/** Violations of `after` that `before` did not have. */
export function newViolations(before: Violation[], after: Violation[]): Violation[] {
  const known = new Set(before.map(idOf));
  return after.filter((v) => !known.has(idOf(v)));
}
