/**
 * YouTube video state → source status (SPEC-12 [А20], AC-27, AC-28, AC-29), ring 1 — pure, time is a parameter.
 *
 * | From YouTube                                         | Result                                   |
 * |------------------------------------------------------|------------------------------------------|
 * | absent from the response                             | dead `missing`                           |
 * | `privacyStatus` other than `public`                  | dead `private`                           |
 * | `embeddable` = false                                 | dead `not-embeddable`                    |
 * | `live`                                               | `live`                                   |
 * | `upcoming`, `scheduledStartTime` in the future       | `expected`, `startsAt` = scheduled time  |
 * | `upcoming`, `scheduledStartTime` passed or absent    | `possible`                               |
 * | `none` with `actualEndTime`                          | dead `ended`                             |
 * | `none` without `actualEndTime` (an ordinary upload)  | dead `not-live`                          |
 */
import type { StreamStatus } from '@time2fest/contracts';
import type { LiveConfig } from './config';

/** The fields of `videos.list` the poller asks for (no titles, no statistics: AC-75). */
export interface YoutubeVideoState {
  videoId: string;
  /** SPEC-21a: the channel of the video (candidate rules); never stored on a source. */
  channelId?: string;
  liveBroadcastContent?: string | null;
  privacyStatus?: string | null;
  embeddable?: boolean | null;
  scheduledStartTime?: string | null;
  actualStartTime?: string | null;
  actualEndTime?: string | null;
}

export const DEAD_REASONS = ['missing', 'private', 'not-embeddable', 'ended', 'not-live'] as const;
export type DeadReason = (typeof DEAD_REASONS)[number];

export type CheckOutcome =
  | { kind: 'alive'; status: StreamStatus; startsAt?: string }
  | { kind: 'dead'; reason: DeadReason };

/** The [А20] table: one video of a `videos.list` answer (or `undefined` when the answer omits it). */
export function statusFromCheck(video: YoutubeVideoState | undefined, now: number): CheckOutcome {
  if (!video) return { kind: 'dead', reason: 'missing' };
  if (video.privacyStatus !== 'public') return { kind: 'dead', reason: 'private' };
  if (video.embeddable !== true) return { kind: 'dead', reason: 'not-embeddable' };
  switch (video.liveBroadcastContent) {
    case 'live':
      return { kind: 'alive', status: 'live' };
    case 'upcoming': {
      const at = Date.parse(video.scheduledStartTime ?? '');
      return Number.isFinite(at) && at > now
        ? { kind: 'alive', status: 'expected', startsAt: new Date(at).toISOString() }
        : { kind: 'alive', status: 'possible' };
    }
    default:
      return { kind: 'dead', reason: video.actualEndTime ? 'ended' : 'not-live' };
  }
}

/**
 * The status published for a stored one (AC-28): `expected` without `startsAt` becomes `possible` once the event
 * moment is `possibleBefore` away or closer. Evaluated in the poller tick by the server clock ([А15]).
 */
export function publishedStatus(
  status: StreamStatus,
  startsAt: string | null | undefined,
  moment: number,
  now: number,
  cfg: LiveConfig,
): StreamStatus {
  if (status === 'expected' && !startsAt && moment - now <= cfg.possibleBeforeMs) return 'possible';
  return status;
}

const STATUSES: ReadonlySet<string> = new Set<StreamStatus>(['live', 'expected', 'possible']);

/** A stored `status` text narrowed to the wire vocabulary; anything else → `null` (not servable). */
export function asStreamStatus(value: string | null | undefined): StreamStatus | null {
  return value && STATUSES.has(value) ? (value as StreamStatus) : null;
}
