/**
 * YouTube Data API adapter (ring 4, SPEC-12 [П-4]). The base URL is injectable, the key travels in a header and comes from
 * env only; no URL, key or body is ever logged or put into an error. No title and no statistics are requested (AC-75).
 */
import type { YoutubeVideoState } from '../domain/live/status';
import type {
  ChannelSource,
  ChannelsResult,
  PlaylistPageResult,
  PlaylistSource,
  SearchResult,
  SearchSource,
  VideoStatusError,
  VideoStatusResult,
  VideoStatusSource,
} from '../live/ports';

export const VIDEO_PARTS = 'snippet,status,liveStreamingDetails';
export const VIDEO_FIELDS =
  'items(id,snippet(channelId,liveBroadcastContent),status(privacyStatus,embeddable),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime))';
export const CHANNEL_PARTS = 'contentDetails';
export const CHANNEL_FIELDS = 'items(id,contentDetails/relatedPlaylists/uploads)';
export const PLAYLIST_PARTS = 'contentDetails';
export const PLAYLIST_FIELDS = 'items/contentDetails/videoId';
export const SEARCH_PARTS = 'id';
export const SEARCH_FIELDS = 'items/id/videoId';
export const DEFAULT_YOUTUBE_BASE_URL = 'https://www.googleapis.com';
const TIMEOUT_MS = 8_000;
const MAX_IDS = 50;

export interface YoutubeAdapterOptions {
  baseUrl?: string;
  apiKey?: string;
  timeoutMs?: number;
}

interface RawItem {
  id?: unknown;
  snippet?: { channelId?: unknown; liveBroadcastContent?: unknown };
  status?: { privacyStatus?: unknown; embeddable?: unknown };
  liveStreamingDetails?: { scheduledStartTime?: unknown; actualStartTime?: unknown; actualEndTime?: unknown };
}

const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

/** Maps one `videos.list` item to the domain shape; titles and statistics are not carried. */
export function mapItem(raw: RawItem): YoutubeVideoState | null {
  const videoId = str(raw.id);
  if (!videoId) return null;
  return {
    videoId,
    channelId: str(raw.snippet?.channelId) ?? undefined,
    liveBroadcastContent: str(raw.snippet?.liveBroadcastContent),
    privacyStatus: str(raw.status?.privacyStatus),
    embeddable: typeof raw.status?.embeddable === 'boolean' ? raw.status.embeddable : null,
    scheduledStartTime: str(raw.liveStreamingDetails?.scheduledStartTime),
    actualStartTime: str(raw.liveStreamingDetails?.actualStartTime),
    actualEndTime: str(raw.liveStreamingDetails?.actualEndTime),
  };
}

async function reason(res: Response): Promise<VideoStatusError> {
  if (res.status === 403) {
    try {
      const body = (await res.json()) as { error?: { errors?: { reason?: unknown }[] } };
      if (body.error?.errors?.some((e) => e.reason === 'quotaExceeded')) return 'quota-exceeded';
    } catch {
      /* the body is never reported */
    }
    return 'invalid';
  }
  return res.status >= 500 || res.status === 429 ? 'unavailable' : 'invalid';
}

export type YoutubeSource = VideoStatusSource & SearchSource & ChannelSource & PlaylistSource;

export function createYoutubeDataSource(options: YoutubeAdapterOptions = {}): YoutubeSource {
  const base = (options.baseUrl ?? DEFAULT_YOUTUBE_BASE_URL).replace(/\/+$/, '');
  const timeoutMs = options.timeoutMs ?? TIMEOUT_MS;
  const headers: Record<string, string> = { accept: 'application/json' };
  if (options.apiKey) headers['X-Goog-Api-Key'] = options.apiKey;

  async function get(path: string, query: URLSearchParams): Promise<Response | null> {
    try {
      return await fetch(`${base}${path}?${query.toString()}`, { headers, signal: AbortSignal.timeout(timeoutMs) });
    } catch {
      return null;
    }
  }

  return {
    async list(ids): Promise<VideoStatusResult> {
      if (ids.length === 0 || ids.length > MAX_IDS) return { error: 'invalid' };
      const res = await get('/youtube/v3/videos', new URLSearchParams({ id: ids.join(','), part: VIDEO_PARTS, fields: VIDEO_FIELDS }));
      if (!res) return { error: 'unavailable' };
      if (!res.ok) return { error: await reason(res) };
      try {
        const body = (await res.json()) as { items?: RawItem[] };
        const items = (body.items ?? []).map(mapItem).filter((v): v is YoutubeVideoState => v !== null);
        return { items };
      } catch {
        return { error: 'unavailable' };
      }
    },
    async search({ channelId }): Promise<SearchResult> {
      const res = await get(
        '/youtube/v3/search',
        new URLSearchParams({ part: SEARCH_PARTS, type: 'video', eventType: 'upcoming', channelId, maxResults: String(MAX_IDS), fields: SEARCH_FIELDS }),
      );
      if (!res) return { error: 'unavailable' };
      if (!res.ok) return { error: await reason(res) };
      try {
        const body = (await res.json()) as { items?: { id?: { videoId?: unknown } }[] };
        return { ids: (body.items ?? []).map((i) => str(i.id?.videoId)).filter((v): v is string => v !== null) };
      } catch {
        return { error: 'unavailable' };
      }
    },
    async channels(ids): Promise<ChannelsResult> {
      if (ids.length === 0 || ids.length > MAX_IDS) return { error: 'invalid' };
      const res = await get('/youtube/v3/channels', new URLSearchParams({ id: ids.join(','), part: CHANNEL_PARTS, fields: CHANNEL_FIELDS }));
      if (!res) return { error: 'unavailable' };
      if (!res.ok) return { error: await reason(res) };
      try {
        const body = (await res.json()) as { items?: { id?: unknown; contentDetails?: { relatedPlaylists?: { uploads?: unknown } } }[] };
        const channels: { id: string; uploadsPlaylistId: string }[] = [];
        for (const i of body.items ?? []) {
          const id = str(i.id);
          const uploadsPlaylistId = str(i.contentDetails?.relatedPlaylists?.uploads);
          if (id && uploadsPlaylistId) channels.push({ id, uploadsPlaylistId });
        }
        return { channels };
      } catch {
        return { error: 'unavailable' };
      }
    },
    async firstPage(playlistId): Promise<PlaylistPageResult> {
      const res = await get(
        '/youtube/v3/playlistItems',
        new URLSearchParams({ playlistId, part: PLAYLIST_PARTS, maxResults: String(MAX_IDS), fields: PLAYLIST_FIELDS }),
      );
      if (!res) return { ok: false, reason: 'unavailable' };
      if (res.status === 404) return { ok: false, reason: 'not-found' };
      if (!res.ok) return { ok: false, reason: await reason(res) };
      try {
        const body = (await res.json()) as { items?: { contentDetails?: { videoId?: unknown } }[] };
        return { ok: true, videoIds: (body.items ?? []).map((i) => str(i.contentDetails?.videoId)).filter((v): v is string => v !== null) };
      } catch {
        return { ok: false, reason: 'unavailable' };
      }
    },
  };
}
