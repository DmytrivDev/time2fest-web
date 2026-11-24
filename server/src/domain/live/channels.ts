/**
 * Channel watch rules of the stream sources (SPEC-21a [А4], [А5], AC-6, AC-26 … AC-28), ring 1 — pure: time and
 * configuration are parameters, no I/O, no clock. Only `watched` channels off the blacklist are read or searched.
 */
import type { ChannelState } from '@time2fest/contracts';
import type { LiveConfig } from './config';

/** A channel as the watch pass reads it (times as epoch ms, absent = `null`). */
export interface WatchChannel {
  state: ChannelState;
  blacklisted?: boolean | null;
  uploadsPlaylistId?: string | null;
  uploadsFetchedAt?: number | null;
  lastPlaylistAt?: number | null;
}

/** One event of the channel's zones and its moment. */
export interface ZoneMoment {
  eventId: string;
  moment: number;
}

const watchable = (c: WatchChannel): boolean => c.state === 'watched' && c.blacklisted !== true;

/** `now` is inside `[moment − playlistNearBefore; moment + playlistNearAfter)` of one of the channel's zone moments. */
export function nearMidnight(moments: readonly number[], now: number, cfg: LiveConfig): boolean {
  return moments.some((m) => now >= m - cfg.playlistNearBeforeMs && now < m + cfg.playlistNearAfterMs);
}

/** The period of the uploads playlist read now ([А4]). */
export function playlistIntervalMs(moments: readonly number[], now: number, cfg: LiveConfig): number {
  return nearMidnight(moments, now, cfg) ? cfg.playlistNearEveryMs : cfg.playlistEveryMs;
}

/** Is a `playlistItems.list` of this channel due (AC-26)? Needs a known uploads playlist. */
export function playlistDue(channel: WatchChannel, moments: readonly number[], now: number, cfg: LiveConfig): boolean {
  if (!watchable(channel) || !channel.uploadsPlaylistId) return false;
  if (channel.lastPlaylistAt == null) return true;
  return now - channel.lastPlaylistAt >= playlistIntervalMs(moments, now, cfg);
}

/** Is a `channels.list` refresh of the uploads playlist due (AC-27: unknown or older than `channelRefreshMs`)? */
export function refreshDue(channel: WatchChannel, now: number, cfg: LiveConfig): boolean {
  if (!watchable(channel)) return false;
  if (!channel.uploadsPlaylistId || channel.uploadsFetchedAt == null) return true;
  return now - channel.uploadsFetchedAt >= cfg.channelRefreshMs;
}

/** `now` is inside the search window `[moment − searchFrom; moment − searchTo]` of a moment ([А5]). */
export function inSearchWindow(moment: number, now: number, cfg: LiveConfig): boolean {
  return now >= moment - cfg.searchFromMs && now <= moment - cfg.searchToMs;
}

/**
 * The event a lawful search of this channel is due for now (AC-28), or `null`: the earliest zone moment whose search
 * window is open, not searched yet in that window (`lastSearchAt` before the window start) and without a candidate
 * of that event in `proposed`, `approved` or `active` (`hasLiveCandidate`).
 */
export function searchDue(
  channel: WatchChannel & { lastSearchAt?: number | null },
  moments: readonly ZoneMoment[],
  hasLiveCandidate: (eventId: string) => boolean,
  now: number,
  cfg: LiveConfig,
): ZoneMoment | null {
  if (!watchable(channel)) return null;
  const open = moments.filter((z) => inSearchWindow(z.moment, now, cfg)).sort((a, b) => a.moment - b.moment || (a.eventId < b.eventId ? -1 : 1));
  for (const z of open) {
    if (channel.lastSearchAt != null && channel.lastSearchAt >= z.moment - cfg.searchFromMs) continue;
    if (hasLiveCandidate(z.eventId)) continue;
    return z;
  }
  return null;
}

/** One more channel may enter `watched` (AC-6; else `limit`). */
export function canWatchMore(watchedCount: number, cfg: LiveConfig): boolean {
  return watchedCount < cfg.maxWatchedChannels;
}
