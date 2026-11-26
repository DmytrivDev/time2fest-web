/**
 * The wire `Stamp` composed at read time from the stored catalog (SPEC-14 [А10], [П-7]; AC-31, AC-36), ring 1, pure.
 * The server keeps only subject, event, `grantedAt`, source and grant kind; the city name and the illustration come
 * from the catalog through the rules' `stampOf` with server lookups over the `StoredCatalog` rows:
 * city name = the city row's Ukrainian name (as `buildStamp`), illustration = one lookup "illustration of the event's
 * unit" (today the country row's `illustrationId`). A changed catalog changes stamps already granted.
 */
import type { PassportStamp } from '@time2fest/contracts';
import { stampOf, type StampEventLike, type StampLookups } from '@time2fest/rules/passport';
import type { PresenceSource } from '@time2fest/rules/time';

type Row = Record<string, unknown>;

/** The catalog collections the view reads. */
export interface StampCatalogRows {
  readonly events: readonly Row[];
  readonly cities: readonly Row[];
  readonly countries: readonly Row[];
}

export interface StampCatalog {
  readonly events: ReadonlyMap<string, StampEventLike>;
  readonly lookups: StampLookups;
}

/** A stored stamp (the fields the view needs). */
export interface StoredStamp {
  readonly eventId: string;
  readonly grantedAt: number;
  readonly presenceSource: PresenceSource;
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** A localized catalog field (`{ uk, … }`) or a plain string → the Ukrainian text. */
function ukOf(v: unknown): string {
  if (typeof v === 'string') return v;
  if (typeof v === 'object' && v !== null) return str((v as Row).uk);
  return '';
}

export function stampCatalogOf(rows: StampCatalogRows): StampCatalog {
  const events = new Map<string, StampEventLike>();
  for (const e of rows.events) {
    const id = str(e.eventId);
    if (!id) continue;
    events.set(id, { id, midnightUtc: str(e.midnightUtc), countryIso: str(e.countryIso), cityId: str(e.cityId) });
  }
  const cityNames = new Map<string, string>();
  for (const c of rows.cities) {
    const name = ukOf(c.name);
    if (str(c.cityId) && name) cityNames.set(str(c.cityId), name);
  }
  const illustrations = new Map<string, string>();
  for (const c of rows.countries) {
    const ill = str(c.illustrationId);
    if (str(c.iso) && ill) illustrations.set(str(c.iso), ill);
  }
  return {
    events,
    lookups: {
      cityName: (cityId) => cityNames.get(cityId),
      illustrationOfUnit: (event) => illustrations.get(event.countryIso),
    },
  };
}

/** The wire stamp of a stored one, or `null` when the event is no longer in the catalog. */
export function stampViewOf(stamp: StoredStamp, catalog: StampCatalog): PassportStamp | null {
  const event = catalog.events.get(stamp.eventId);
  if (!event) return null;
  // `grantedAt` is the stored one (an old-moment grant keeps the old moment's time, AC-23, AC-32).
  return { ...stampOf(event, catalog.lookups, stamp.presenceSource), grantedAt: stamp.grantedAt };
}
