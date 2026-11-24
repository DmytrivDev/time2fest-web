/**
 * The candidate fields of a `videos.list` answer (SPEC-21a AC-7), ring 3: one mapper for the cheap check of the
 * sources services and the refresh of the sources watch. The callers add `channelId` and `checkedAt` as they need.
 */
import type { YoutubeVideoState } from '../domain/live/status';
import type { StoredCandidate } from './ports';

export function videoFields(v: YoutubeVideoState, at: number): Partial<StoredCandidate> {
  return {
    liveBroadcastContent: v.liveBroadcastContent ?? null,
    scheduledStartTime: v.scheduledStartTime ? Date.parse(v.scheduledStartTime) || null : null,
    embeddable: v.embeddable ?? null,
    privacyStatus: v.privacyStatus ?? null,
    ytFetchedAt: at,
  };
}
