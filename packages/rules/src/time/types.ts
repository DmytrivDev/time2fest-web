/** Structural types only: the package imports nothing from the site or the server. */
export type Ms = number;

export interface MidnightLike {
  readonly midnightMs: Ms;
}

export interface ZonesLike {
  readonly zones: readonly MidnightLike[];
}

export interface EventLike {
  readonly id: string;
  readonly midnightUtc: string;
  readonly midnightMs?: Ms;
}

export type EventStatus = 'soon' | 'live' | 'ended' | 'recording';
export type ZoneState = 'past' | 'live' | 'next' | 'future';
export type PresenceSource = 'country' | 'air' | 'room' | 'tv';
export type ToastSeason = 'before' | 'during' | 'after';

/** One presence pulse: when the server received it, plus the client-side times it may carry. */
export interface Pulse {
  readonly receivedAt: Ms;
  readonly openedAt?: Ms;
  readonly at?: Ms;
}
