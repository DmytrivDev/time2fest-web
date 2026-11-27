/**
 * Stamp composer, Dataset-free (SPEC-14 [П-7], AC-36, AC-31). Same output fields and rules as `buildStamp`
 * (`lib/engine/stamp.ts`): one stamp per event (city), the illustration is one lookup "illustration of the event's unit".
 */
import { midnightOf, stampGrantedAt } from '../time';
import type { Ms, PresenceSource } from '../time';

export interface StampEventLike {
  readonly id: string;
  readonly midnightUtc: string;
  readonly midnightMs?: Ms;
  readonly countryIso: string;
  readonly cityId: string;
}

export interface StampLookups {
  /** City name (the base language), `undefined` when unknown. */
  cityName(cityId: string): string | undefined;
  /** Illustration of the event's unit (today the country row's), `undefined` when unknown. */
  illustrationOfUnit(event: StampEventLike): string | undefined;
}

export interface StampOut {
  eventId: string;
  grantedAt: Ms;
  presenceSource: PresenceSource;
  illustrationId: string;
  cityName: string;
  countryIso: string;
}

/** Stamp for an event: `grantedAt` = midnight + 15 s. */
export function stampOf(event: StampEventLike, lookups: StampLookups, presenceSource: PresenceSource): StampOut {
  return {
    eventId: event.id,
    grantedAt: stampGrantedAt(midnightOf(event)),
    presenceSource,
    illustrationId: lookups.illustrationOfUnit(event) ?? 'generic',
    cityName: lookups.cityName(event.cityId) ?? '',
    countryIso: event.countryIso,
  };
}
