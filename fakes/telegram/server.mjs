// @ts-check
/**
 * Fake Telegram Bot API for tests (SPEC-13b AC-16). `node:http` only, no dependencies, loopback only.
 * Speaks `POST /bot<token>/sendMessage` (JSON body). The answer depends on the mode set through
 * `POST /_control/mode`; every request is recorded for `GET /_control/calls` with the token cut out
 * of the path. The token is never logged or returned. Not declared in `docker-compose.yml`: tests
 * start it with `startFakeTelegram({ port: 0 })` and pass the URL as `T2F_TELEGRAM_API_BASE`.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

/** @typedef {'ok' | 'chat-not-found' | 'forbidden' | 'rate-limit' | 'error' | 'down'} FakeTelegramMode */

/** @type {readonly FakeTelegramMode[]} */
const MODES = ['ok', 'chat-not-found', 'forbidden', 'rate-limit', 'error', 'down'];
const SEND_PATH = /^\/bot([^/]+)\/sendMessage$/;
const DEFAULT_RETRY_AFTER = 5;

/**
 * @typedef {{
 *   path: string,
 *   chat_id: unknown,
 *   text: unknown,
 *   disable_web_page_preview: unknown,
 *   parse_mode?: unknown,
 *   tokenMatches: boolean,
 *   at: string,
 * }} FakeTelegramCall
 */

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

/** @param {number} code @param {string} description @param {Record<string, unknown>} [extra] */
const apiError = (code, description, extra = {}) => ({ ok: false, error_code: code, description, ...extra });

/**
 * @param {{ port?: number, token?: string }} [options] `token` — when set, any other token gets 401.
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startFakeTelegram({ port = 0, token } = {}) {
  /** @type {FakeTelegramMode} */
  let mode = 'ok';
  /** Requests left in `mode` before it falls back to `ok`; `null` — for good. */
  /** @type {number | null} */
  let timesLeft = null;
  let retryAfter = DEFAULT_RETRY_AFTER;
  let messageId = 0;
  /** @type {FakeTelegramCall[]} */
  let calls = [];

  /** The mode for this request; counts down `times`. */
  const takeMode = () => {
    const current = mode;
    if (current !== 'ok' && timesLeft !== null) {
      timesLeft -= 1;
      if (timesLeft <= 0) {
        mode = 'ok';
        timesLeft = null;
      }
    }
    return current;
  };

  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = u.pathname;
    try {
      if (path === '/_control/calls' && req.method === 'GET') return send(res, 200, { calls });
      if (path === '/_control/reset' && req.method === 'POST') {
        mode = 'ok';
        timesLeft = null;
        retryAfter = DEFAULT_RETRY_AFTER;
        messageId = 0;
        calls = [];
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/down' && req.method === 'POST') {
        const b = /** @type {{ on?: unknown } | null} */ (await readBody(req));
        if (!b || typeof b.on !== 'boolean') return send(res, 400, { error: 'on' });
        mode = b.on ? 'down' : 'ok';
        timesLeft = null;
        return send(res, 200, { ok: true });
      }
      if (path === '/_control/mode' && req.method === 'POST') {
        const b = /** @type {{ mode?: unknown, retryAfter?: unknown, times?: unknown } | null} */ (await readBody(req));
        if (!b || typeof b.mode !== 'string' || !MODES.includes(/** @type {FakeTelegramMode} */ (b.mode))) return send(res, 400, { error: 'mode' });
        if (b.retryAfter !== undefined && (typeof b.retryAfter !== 'number' || !Number.isInteger(b.retryAfter) || b.retryAfter < 0)) return send(res, 400, { error: 'retryAfter' });
        if (b.times !== undefined && (typeof b.times !== 'number' || !Number.isInteger(b.times) || b.times < 1)) return send(res, 400, { error: 'times' });
        mode = /** @type {FakeTelegramMode} */ (b.mode);
        timesLeft = typeof b.times === 'number' ? b.times : null;
        retryAfter = typeof b.retryAfter === 'number' ? b.retryAfter : DEFAULT_RETRY_AFTER;
        return send(res, 200, { ok: true });
      }

      const m = SEND_PATH.exec(path);
      if (m && req.method === 'POST') {
        const b = /** @type {Record<string, unknown> | null} */ (await readBody(req));
        /** @type {FakeTelegramCall} */
        const call = {
          path: '/bot<token>/sendMessage',
          chat_id: b?.chat_id,
          text: b?.text,
          disable_web_page_preview: b?.disable_web_page_preview,
          tokenMatches: token === undefined || m[1] === token,
          at: new Date().toISOString(),
        };
        if (b && 'parse_mode' in b) call.parse_mode = b.parse_mode;
        calls.push(call);

        const current = takeMode();
        if (current === 'down') {
          req.socket.destroy();
          return;
        }
        if (!call.tokenMatches) return send(res, 401, apiError(401, 'Unauthorized'));
        if (!b || typeof b.text !== 'string' || (typeof b.chat_id !== 'string' && typeof b.chat_id !== 'number')) {
          return send(res, 400, apiError(400, 'Bad Request: message text is empty'));
        }
        if (current === 'chat-not-found') return send(res, 400, apiError(400, 'Bad Request: chat not found'));
        if (current === 'forbidden') return send(res, 403, apiError(403, 'Forbidden: bot was blocked by the user'));
        if (current === 'rate-limit') {
          return send(res, 429, apiError(429, `Too Many Requests: retry after ${retryAfter}`, { parameters: { retry_after: retryAfter } }));
        }
        if (current === 'error') return send(res, 502, apiError(502, 'Bad Gateway'));
        messageId += 1;
        return send(res, 200, { ok: true, result: { message_id: messageId, chat: { id: b.chat_id }, date: Math.floor(Date.now() / 1000), text: b.text } });
      }
      return send(res, 404, apiError(404, 'Not Found'));
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
  const { url } = await startFakeTelegram({ port });
  process.stdout.write(`fake Telegram listening on ${url}\n`);
}
