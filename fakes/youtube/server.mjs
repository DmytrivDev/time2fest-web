// @ts-check
/**
 * Fake YouTube Data API for tests (SPEC-12 AC-71). `node:http` only, no dependencies, loopback only.
 * Speaks `GET /youtube/v3/videos?id=a,b&part=…&fields=…`, `channels` (uploads playlist), `playlistItems` (video ids) and
 * `search` (controlled ids per channel; SPEC-21a AC-43). State is set through `POST /_control/{videos,channels,search}`;
 * it never serves titles, descriptions, thumbnails or statistics (AC-75, AC-47).
 * Not declared in `docker-compose.yml`: tests start it with `startFakeYoutube({ port: 0 })`.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_IDS = 50;
const STATES = ['live', 'upcoming', 'ended', 'none', 'private', 'deleted'];
const BUCKETS = ['queries', 'search', 'candidates', 'playlists'];
const ID_RE = /^[A-Za-z0-9_-]{2,64}$/;

/** @typedef {{ state: string, scheduledStartTime?: string, embeddable?: boolean }} VideoState */

/** @param {import('node:http').IncomingMessage} req */
async function readBody(req) {
  /** @type {Buffer[]} */
  const chunks = [];
  for await (const c of req) chunks.push(/** @type {Buffer} */ (c));
  const raw = Buffer.concat(chunks).toString('utf8');
  if (raw === '') return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * @param {import('node:http').ServerResponse} res
 * @param {number} status
 * @param {unknown} body
 */
function send(res, status, body) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(json) });
  res.end(json);
}

/** @param {number} status @param {string} reason */
const apiError = (status, reason) => ({ error: { code: status, message: reason, errors: [{ reason }] } });

/** @typedef {{ uploads: string, videos: string[], deleted: boolean }} ChannelState */

/** @param {string} id @param {VideoState} v @param {string | null} [channelId] @returns {Record<string, unknown> | null} */
function itemOf(id, v, channelId = null) {
  if (v.state === 'deleted') return null;
  const live = v.state === 'live' || v.state === 'private';
  const content = live ? 'live' : v.state === 'upcoming' ? 'upcoming' : 'none';
  /** @type {Record<string, string>} */
  const details = {};
  if (v.state === 'upcoming' && v.scheduledStartTime) details.scheduledStartTime = v.scheduledStartTime;
  if (live) details.actualStartTime = '2026-12-31T20:00:00Z';
  if (v.state === 'ended') {
    details.actualStartTime = '2026-12-31T20:00:00Z';
    details.actualEndTime = '2026-12-31T23:00:00Z';
  }
  return {
    id,
    snippet: channelId ? { channelId, liveBroadcastContent: content } : { liveBroadcastContent: content },
    status: { privacyStatus: v.state === 'private' ? 'private' : 'public', embeddable: v.embeddable !== false },
    liveStreamingDetails: details,
  };
}

/**
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startFakeYoutube({ port = 0 } = {}) {
  /** @type {Map<string, VideoState>} */
  let videos = new Map();
  /** @type {Map<string, ChannelState>} */
  let channels = new Map();
  /** @type {Map<string, string[]>} */
  let searchResults = new Map();
  /** @type {Record<string, boolean>} */
  let exceeded = { queries: false, search: false, candidates: false, playlists: false };
  let down = false;
  /** @type {Record<string, number>} */
  let counts = {};
  /** @type {{ path: string, ids: string[], part: string | null, fields: string | null, params: Record<string, string> }[]} */
  let calls = [];

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = u.pathname;
    try {
      if (path === '/_control/calls' && req.method === 'GET') return send(res, 200, { counts, calls });
      if (path === '/_control/reset' && req.method === 'POST') {
        videos = new Map();
        channels = new Map();
        searchResults = new Map();
        exceeded = { queries: false, search: false, candidates: false, playlists: false };
        down = false;
        counts = {};
        calls = [];
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/down' && req.method === 'POST') {
        const b = /** @type {{ on?: unknown } | null} */ (await readBody(req));
        if (!b || typeof b.on !== 'boolean') return send(res, 400, { error: 'on' });
        down = b.on;
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/quota' && req.method === 'POST') {
        const b = /** @type {{ bucket?: unknown, exceeded?: unknown } | null} */ (await readBody(req));
        if (!b || typeof b.bucket !== 'string' || !BUCKETS.includes(b.bucket) || typeof b.exceeded !== 'boolean') return send(res, 400, { error: 'quota' });
        exceeded[b.bucket] = b.exceeded;
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/videos' && req.method === 'POST') {
        const b = /** @type {{ videos?: { id?: unknown, state?: unknown, scheduledStartTime?: unknown, embeddable?: unknown }[] } | null} */ (await readBody(req));
        if (!b || !Array.isArray(b.videos)) return send(res, 400, { error: 'videos' });
        for (const v of b.videos) {
          if (typeof v.id !== 'string' || typeof v.state !== 'string' || !STATES.includes(v.state)) return send(res, 400, { error: 'video' });
          /** @type {VideoState} */
          const s = { state: v.state };
          if (typeof v.scheduledStartTime === 'string') s.scheduledStartTime = v.scheduledStartTime;
          if (typeof v.embeddable === 'boolean') s.embeddable = v.embeddable;
          videos.set(v.id, s);
        }
        return send(res, 200, { ok: true });
      }

      if (path === '/_control/channels' && req.method === 'POST') {
        const b = /** @type {{ channels?: { id?: unknown, uploads?: unknown, videos?: unknown, deleted?: unknown }[] } | null} */ (await readBody(req));
        if (!b || !Array.isArray(b.channels)) return send(res, 400, { error: 'channels' });
        for (const c of b.channels) {
          if (typeof c.id !== 'string' || !ID_RE.test(c.id)) return send(res, 400, { error: 'channel' });
          if (c.uploads !== undefined && (typeof c.uploads !== 'string' || !ID_RE.test(c.uploads))) return send(res, 400, { error: 'channel' });
          if (c.videos !== undefined && (!Array.isArray(c.videos) || c.videos.some((v) => typeof v !== 'string'))) return send(res, 400, { error: 'channel' });
          channels.set(c.id, {
            uploads: typeof c.uploads === 'string' ? c.uploads : `UU${c.id.slice(2)}`,
            videos: Array.isArray(c.videos) ? /** @type {string[]} */ (c.videos) : [],
            deleted: c.deleted === true,
          });
        }
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/search' && req.method === 'POST') {
        const b = /** @type {{ channelId?: unknown, ids?: unknown } | null} */ (await readBody(req));
        if (!b || typeof b.channelId !== 'string' || !Array.isArray(b.ids) || b.ids.some((v) => typeof v !== 'string')) return send(res, 400, { error: 'search' });
        searchResults.set(b.channelId, /** @type {string[]} */ (b.ids));
        return send(res, 200, { ok: true });
      }

      const isVideos = path === '/youtube/v3/videos';
      const isSearch = path === '/youtube/v3/search';
      const isChannels = path === '/youtube/v3/channels';
      const isPlaylist = path === '/youtube/v3/playlistItems';
      if (req.method === 'GET' && (isVideos || isSearch || isChannels || isPlaylist)) {
        const ids = (u.searchParams.get('id') ?? '').split(',').filter((s) => s !== '');
        counts[path] = (counts[path] ?? 0) + 1;
        calls.push({
          path,
          ids,
          part: u.searchParams.get('part'),
          fields: u.searchParams.get('fields'),
          params: Object.fromEntries(u.searchParams.entries()),
        });
        if (down) return send(res, 503, apiError(503, 'backendError'));
        // Buckets: search is stopped by `search` or `candidates`, playlistItems by `playlists` or `queries`, the rest by `queries`.
        const stopped = isSearch ? exceeded.search || exceeded.candidates : isPlaylist ? exceeded.playlists || exceeded.queries : exceeded.queries;
        if (stopped) return send(res, 403, apiError(403, 'quotaExceeded'));
        if (isSearch) {
          const channelId = u.searchParams.get('channelId');
          const found = channelId && u.searchParams.get('eventType') === 'upcoming' && u.searchParams.get('type') === 'video' ? searchResults.get(channelId) : undefined;
          return send(res, 200, { items: (found ?? []).map((videoId) => ({ id: { videoId } })) });
        }
        if (isChannels) {
          if (ids.length === 0 || ids.length > MAX_IDS) return send(res, 400, apiError(400, 'badRequest'));
          const items = [];
          for (const id of ids) {
            const c = channels.get(id);
            if (c && !c.deleted) items.push({ id, contentDetails: { relatedPlaylists: { uploads: c.uploads } } });
          }
          return send(res, 200, { items });
        }
        if (isPlaylist) {
          const playlistId = u.searchParams.get('playlistId') ?? '';
          const max = Number(u.searchParams.get('maxResults') ?? '5');
          if (!Number.isInteger(max) || max < 1 || max > MAX_IDS) return send(res, 400, apiError(400, 'badRequest'));
          const owner = [...channels.values()].find((c) => !c.deleted && c.uploads === playlistId);
          if (!owner) return send(res, 404, apiError(404, 'playlistNotFound'));
          // `videos` of a channel are newest first, as the real uploads playlist.
          return send(res, 200, { items: owner.videos.slice(0, max).map((videoId) => ({ contentDetails: { videoId } })) });
        }
        if (ids.length === 0 || ids.length > MAX_IDS) return send(res, 400, apiError(400, 'badRequest'));
        const items = [];
        for (const id of ids) {
          const v = videos.get(id);
          const owner = [...channels.entries()].find(([, c]) => c.videos.includes(id));
          const item = v ? itemOf(id, v, owner ? owner[0] : null) : null;
          if (item) items.push(item);
        }
        return send(res, 200, { items });
      }
      return send(res, 404, { error: 'not-found' });
    } catch {
      return send(res, 500, { error: 'fake' });
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(undefined));
  });
  const address = /** @type {import('node:net').AddressInfo} */ (server.address());
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const i = process.argv.indexOf('--port');
  const port = i >= 0 ? Number(process.argv[i + 1]) : 0;
  const { url } = await startFakeYoutube({ port });
  process.stdout.write(`fake YouTube listening on ${url}\n`);
}
