/**
 * Catalog contract (SPEC-04, types only; no zod here, so the site bundle stays zod-free): the reason
 * of a refused catalog read, and the shape of `GET /api/catalog`. The wire schemas are in `catalog.schemas.ts`.
 */

/** Why `GET /api/catalog` is `unavailable`: the stored catalog breaks an integrity rule (AC-65). */
export const CATALOG_REASONS = ['catalog-invalid'] as const;
export type CatalogReason = (typeof CATALOG_REASONS)[number];

/** The `{ uk }` language form of the data files. */
export interface CatalogText {
  uk: string;
}

export type CatalogCelebrationType = 'main' | 'webcam' | 'tv' | 'countdown-only';

export interface CatalogScheduleEvent {
  id: string;
  midnightUtc: string;
  isMainCelebration: boolean;
  type: CatalogCelebrationType;
  popularity: number;
  restrained?: { note: CatalogText };
}

export interface CatalogScheduleCity {
  id: string;
  name: CatalogText;
  landmark?: CatalogText;
  celebrationType: CatalogCelebrationType;
  isCountryMain: boolean;
  mapPoint: { x: number; y: number };
  events: CatalogScheduleEvent[];
}

export interface CatalogScheduleZone {
  id: string;
  order: number;
  offsetMinutes: number;
  midnightUtc: string;
  representativeCityId: string;
  countries: { iso: string; cities: CatalogScheduleCity[] }[];
}

/** The shape of `data/schedule.json`. */
export interface CatalogSchedule {
  $schema?: string;
  version: 1;
  season: string;
  generatedAt: string;
  tzdbVersion: string;
  zones: CatalogScheduleZone[];
}

export interface CatalogTradition {
  id: string;
  title: string;
  text: string;
  iconId: string;
}

export interface CatalogCountry {
  iso: string;
  slug: string;
  name: CatalogText;
  gender: string;
  flagCode: string;
  zoneIds: string[];
  illustrationId: string;
  howTo: { traditions: CatalogTradition[]; text: string; gallery: unknown[] };
  popularity: number;
}

/** The shape of `data/countries.json`. */
export interface CatalogCountries {
  version: 1;
  countries: CatalogCountry[];
}

/** The value of `GET /api/catalog` (inside `ApiResult`). */
export interface CatalogPayload {
  version: string;
  schedule: CatalogSchedule;
  countries: CatalogCountries;
}
