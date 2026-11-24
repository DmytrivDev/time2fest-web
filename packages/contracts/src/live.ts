/** Live wire vocabulary (SPEC-12). Zod-free types and constants; schemas live in `live.schemas.ts`. */

export type LiveISO = string;
export type StreamPlatform = 'youtube' | 'facebook' | 'twitch';
export type StreamStatus = 'live' | 'expected' | 'possible';
export type StreamKind = 'main' | 'webcam' | 'tv';

export interface StreamSource {
  id: string;
  platform: StreamPlatform;
  videoId?: string;
  url: string;
  kind: StreamKind;
  title: { uk: string };
  order: number;
  status: StreamStatus;
  startsAt?: LiveISO;
  embeddable: boolean;
  lastChecked: LiveISO;
  verified: boolean;
  isLive: boolean;
  replay?: { videoId?: string; url: string };
  isRecording?: boolean;
  test?: boolean;
  testNote?: string;
  alwaysOn?: boolean;
  sync?: { midnightSec: number; durationSec?: number };
  override?: boolean;
}

export interface StreamChain {
  eventId: string;
  sources: StreamSource[];
  version?: number;
}

/** `version` is required on the wire. */
export type StreamEvent =
  | { type: 'source'; eventId: string; source: StreamSource; version: number }
  | { type: 'chain'; chain: StreamChain; version: number }
  | { type: 'hide'; eventId: string; sourceId: string; version: number };

export interface ChainsResponse {
  version: number;
  at: LiveISO;
  chains: StreamChain[];
}

export interface ViewerCountry {
  iso: string;
  name: string;
  flagCode: string;
}

export interface ViewerSummary {
  countries: ViewerCountry[];
  people?: number;
  at: LiveISO;
}

/** YouTube IFrame API error codes the player may report. */
export const SOURCE_ERROR_CODES = [2, 5, 100, 101, 150, 153] as const;
export type SourceErrorCode = (typeof SOURCE_ERROR_CODES)[number];

export interface SourceErrorReport {
  eventId: string;
  sourceId: string;
  code: SourceErrorCode;
}

export const LIVE_STREAMS_CLASS = 'live:streams';
export const LIVE_VIEWERS_CLASS = 'live:viewers';
export const LIVE_R2_KEYS = { chains: 'live/chains.json' } as const;
export const LIVE_CACHE_TAG = 't2f-live-chains';

export const LIVE_ACTIONS = ['hide', 'unhide', 'main', 'override', 'zone-live', 'replace'] as const;
export type LiveAction = (typeof LIVE_ACTIONS)[number];
export const LIVE_REASON_MAX = 200;

export type LiveActionBody =
  | { action: 'hide' | 'unhide' | 'main'; eventId: string; sourceId: string; reason: string }
  /** Forces a source playable; removing or ending a source is `hide` ([А-R3]). */
  | { action: 'override'; eventId: string; sourceId: string; status: 'live'; reason: string }
  | { action: 'zone-live'; zoneId: string; live: boolean; reason: string }
  | { action: 'replace'; eventId: string; sourceId: string; videoId: string; reason: string };

export const LIVE_VIDEO_STATES = ['live', 'upcoming', 'ended', 'private', 'not-embeddable', 'missing'] as const;
export type LiveVideoState = (typeof LIVE_VIDEO_STATES)[number];

/** Test door `POST /api/_test/live` (class `test` only). */
export type LiveDoorBody =
  | { door: 'video-status'; videoId: string; state: LiveVideoState }
  | { door: 'quota'; used: number; exceeded?: boolean; bucket?: LiveDoorQuotaBucket }
  | { door: 'viewers'; people: number; countries: string[] }
  | { door: 'hide'; eventId: string; sourceId: string }
  | { door: 'reset-live' }
  /** SPEC-21a: what the fake YouTube knows about channels (uploads playlist, its videos, deleted). */
  | { door: 'channels'; channels: LiveDoorChannel[] }
  /** SPEC-21a: the fake's `search.list` result for one channel. */
  | { door: 'search-results'; channelId: string; ids: string[] };

/** Counters the `quota` door may set (SPEC-21a adds the class counters; absent = `queries`). */
export const LIVE_DOOR_QUOTA_BUCKETS = ['queries', 'search', 'candidates', 'playlists'] as const;
export type LiveDoorQuotaBucket = (typeof LIVE_DOOR_QUOTA_BUCKETS)[number];

export interface LiveDoorChannel {
  id: string;
  uploads?: string;
  videos?: string[];
  deleted?: true;
}

export const LIVE_ARCHIVE_DECISIONS = ['kept', 'hidden', 'dead', 'replaced'] as const;
export type LiveArchiveDecision = (typeof LIVE_ARCHIVE_DECISIONS)[number];

/** Season archive row: ids, our labels, order and decision only (no titles or statistics from YouTube). */
export interface LiveArchiveRow {
  videoId: string;
  label: string;
  order: number;
  decision: LiveArchiveDecision;
}
