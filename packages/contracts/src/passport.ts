/**
 * Passport wire vocabulary (SPEC-14). Types and constants only: zod-free, re-exported from `index.ts`.
 * The service interface stays in `lib/api/contracts/passport.ts`; the schemas are in `passport.schemas.ts`.
 */

/** `ApiError.reason` values of the stamp routes (additive; `no-presence` is `forbidden`). */
export const PASSPORT_REASONS = ['claim-closed', 'no-presence', 'unknown-event'] as const;
export type PassportReason = (typeof PASSPORT_REASONS)[number];

/** Where the page showed the event (mirrors `PresenceSource` of the site data types). */
export const PRESENCE_SOURCES = ['country', 'air', 'room', 'tv'] as const;
export type PresenceSourceWire = (typeof PRESENCE_SOURCES)[number];

/** How a stamp was granted: by presence at midnight, during recorded downtime, or for an old moment. */
export const GRANT_KINDS = ['presence', 'downtime', 'old-moment'] as const;
export type GrantKind = (typeof GRANT_KINDS)[number];

/** Wire `Stamp`: equal to `lib/data/types.ts` `Stamp`. */
export interface PassportStamp {
  eventId: string;
  grantedAt: number;
  presenceSource: PresenceSourceWire;
  illustrationId: string;
  cityName: string;
  countryIso: string;
}

/** Event on channel `user:#<subject>`: a granted stamp, or the full list after a merge or reconnect. */
export type StampEvent = {
  type: 'stamp';
  id: string;
  data: { kind: 'granted'; stamp: PassportStamp } | { kind: 'snapshot'; stamps: PassportStamp[] };
};

/** `POST /api/presence` response: when to beat next, or `null` when no known event needs a beat. */
export interface PresenceBeatResponse {
  nextBeatMs: number | null;
}
