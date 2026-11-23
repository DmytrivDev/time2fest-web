/**
 * Ports of the live-air capability (SPEC-12), ring 2. They name the conversation, never a vendor type.
 * `LiveStore`, `QuotaStore`, `PresenceSource` and `LiveLease` are filled in by the adapters of later phases.
 */
import type { QuotaBucket } from '../domain/live/config';
import type { YoutubeVideoState } from '../domain/live/status';

export type VideoStatusError = 'quota-exceeded' | 'unavailable' | 'invalid';

export type VideoStatusResult = { items: YoutubeVideoState[] } | { error: VideoStatusError };

/** One `videos.list` conversation: at most 50 ids; an id missing from `items` is gone. */
export interface VideoStatusSource {
  list(ids: readonly string[]): Promise<VideoStatusResult>;
}

/** A search call exists only to be counted (the poller never uses its result). */
export interface SearchSource {
  search(): Promise<{ ok: true } | { error: VideoStatusError }>;
}

export interface QuotaStore {
  charge(day: string, bucket: QuotaBucket | 'ad-hoc', units: number): Promise<number>;
  markExceeded(day: string, bucket: QuotaBucket): Promise<void>;
  mark80(day: string, bucket: QuotaBucket): Promise<boolean>;
}

export interface LiveStore {
  readonly kind: 'live-store';
}

export interface PresenceSource {
  presence(channel: string): Promise<number>;
}

export interface LiveLease {
  acquire(name: 'live-poller' | 'live-viewers', ttlMs: number): Promise<boolean>;
  release(name: 'live-poller' | 'live-viewers'): Promise<void>;
}
