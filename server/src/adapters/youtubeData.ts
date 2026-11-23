/**
 * YouTube Data API adapter (ring 4, SPEC-12 [П-4]). The base URL is injectable, the key travels in a header and comes from
 * env only; no URL, key or body is ever logged or put into an error. No title and no statistics are requested (AC-75).
 */
import type { YoutubeVideoState } from '../domain/live/status';
import type { SearchSource, VideoStatusError, VideoStatusResult, VideoStatusSource } from '../live/ports';

export const VIDEO_PARTS = 'snippet,status,liveStreamingDetails';
export const VIDEO_FIELDS =
  'items(id,snippet/liveBroadcastContent,status(privacyStatus,embeddable),liveStreamingDetails(scheduledStartTime,actualStartTime,actualEndTime))';
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
  snippet?: { liveBroadcastContent?: unknown };
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

export function createYoutubeDataSource(options: YoutubeAdapterOptions = {}): VideoStatusSource & SearchSource {
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
    async search() {
      const res = await get('/youtube/v3/search', new URLSearchParams({ part: 'id', type: 'video', eventType: 'live', maxResults: '1' }));
      if (!res) return { error: 'unavailable' };
      return res.ok ? { ok: true } : { error: await reason(res) };
    },
  };
}
