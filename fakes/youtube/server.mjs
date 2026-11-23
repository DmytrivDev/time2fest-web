// @ts-check
/**
 * Fake YouTube Data API for tests (SPEC-12 AC-71). `node:http` only, no dependencies, loopback only.
 * Speaks `GET /youtube/v3/videos?id=a,b&part=…&fields=…` and `GET /youtube/v3/search` (exists only to be refused or counted).
 * State is set through `POST /_control/videos`; it never serves titles or statistics (AC-75).
 * Not declared in `docker-compose.yml`: tests start it with `startFakeYoutube({ port: 0 })`.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const MAX_IDS = 50;
const STATES = ['live', 'upcoming', 'ended', 'none', 'private', 'deleted'];

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

/** @param {string} id @param {VideoState} v @returns {Record<string, unknown> | null} */
function itemOf(id, v) {
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
    snippet: { liveBroadcastContent: content },
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
  let exceeded = { queries: false, search: false };
  let down = false;
  /** @type {Record<string, number>} */
  let counts = {};
  /** @type {{ path: string, ids: string[], part: string | null, fields: string | null }[]} */
  let calls = [];

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = u.pathname;
    try {
      if (path === '/_control/calls' && req.method === 'GET') return send(res, 200, { counts, calls });
      if (path === '/_control/reset' && req.method === 'POST') {
        videos = new Map();
        exceeded = { queries: false, search: false };
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
        if (!b || (b.bucket !== 'queries' && b.bucket !== 'search') || typeof b.exceeded !== 'boolean') return send(res, 400, { error: 'quota' });
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

      const isVideos = path === '/youtube/v3/videos';
      const isSearch = path === '/youtube/v3/search';
      if (req.method === 'GET' && (isVideos || isSearch)) {
        const ids = (u.searchParams.get('id') ?? '').split(',').filter((s) => s !== '');
        counts[path] = (counts[path] ?? 0) + 1;
        calls.push({ path, ids, part: u.searchParams.get('part'), fields: u.searchParams.get('fields') });
        if (down) return send(res, 503, apiError(503, 'backendError'));
        if (exceeded[isVideos ? 'queries' : 'search']) return send(res, 403, apiError(403, 'quotaExceeded'));
        if (isSearch) return send(res, 200, { items: [] });
        if (ids.length === 0 || ids.length > MAX_IDS) return send(res, 400, apiError(400, 'badRequest'));
        const items = [];
        for (const id of ids) {
          const v = videos.get(id);
          const item = v ? itemOf(id, v) : null;
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
