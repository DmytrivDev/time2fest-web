/** Realtime wire types (SPEC-06). Types only: zod-free, re-exported from `index.ts`. */

/** One event on a channel. `version` is monotonic per channel; events without it are idempotent by `id`. */
export interface RealtimeEnvelope {
  type: string;
  id: string;
  version?: number;
  data?: unknown;
}

/** Packed events of a batched channel class; the transport unpacks it. */
export interface RealtimeBatch {
  type: 'batch';
  id: string;
  events: RealtimeEnvelope[];
}

/** `GET /api/realtime/token` value: both `null` when realtime is not configured. */
export interface RealtimeTokenValue {
  token: string | null;
  expiresAt: string | null;
}

export type RealtimeSubjectKind = 'guest' | 'account';

export const REALTIME_REASONS = ['realtime-not-configured'] as const;
export type RealtimeReason = (typeof REALTIME_REASONS)[number];

export const REALTIME_MAX_PUBLICATION_BYTES = 65_536;
export const REALTIME_MAX_BATCH_EVENTS = 200;
