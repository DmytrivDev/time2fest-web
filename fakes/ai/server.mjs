// @ts-check
/**
 * Fake AI providers for tests and the load run (SPEC-09 AC-49). `node:http` only, no dependencies.
 * Speaks the Anthropic Messages wire (`POST /v1/messages`) and the OpenAI-compatible DeepSeek wire
 * (`POST /chat/completions`); behaviour is set per provider through `POST /_control/<provider>`.
 * Not declared in `docker-compose.yml` (SPEC-02 AC-4): tests and the load runner start it.
 */
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';

const RING = 100;

/** @typedef {{ marker: string, score: number }} ScoreRule */
/** @typedef {{ score: number | ScoreRule | ScoreRule[], translation: string | null, delayMs: number, errorRate: number, down: number | null, usage: Record<string, number> | null | undefined, corrupt: 'prose' | 'empty' | 'out-of-range' | null, refuse: boolean }} Knobs */

/** @returns {Knobs} */
function defaults() {
  return { score: 0, translation: null, delayMs: 0, errorRate: 0, down: null, usage: undefined, corrupt: null, refuse: false };
}

/** @param {string} provider */
function defaultUsage(provider) {
  return provider === 'anthropic'
    ? { input_tokens: 50, output_tokens: 5, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }
    : { prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 50, completion_tokens: 5 };
}

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

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** The user text inside the delimiters, or the whole content when there are none. */
function delimited(/** @type {string} */ content) {
  // The adapters add a random per-request tag (`<<<T2F_TEXT_<hex>` … `T2F_TEXT_<hex>>>>`).
  const m = /<<<T2F_TEXT(?:_[0-9a-f]+)?([\s\S]*)T2F_TEXT(?:_[0-9a-f]+)?>>>/.exec(content);
  return m ? (m[1] ?? '') : content;
}

/** @param {Knobs['score']} rule @param {string} text */
function scoreFor(rule, text) {
  if (typeof rule === 'number') return rule;
  const rules = Array.isArray(rule) ? rule : [rule];
  for (const r of rules) if (r.marker !== '' && text.includes(r.marker)) return r.score;
  return 0;
}

/**
 * @param {{ port?: number }} [options]
 * @returns {Promise<{ url: string, close: () => Promise<void> }>}
 */
export async function startFakeAi({ port = 0 } = {}) {
  /** @type {Record<string, Knobs>} */
  const knobs = { anthropic: defaults(), deepseek: defaults() };
  /** @type {{ provider: string, path: string, headers: Record<string, string | string[] | undefined>, body: unknown, at: number }[]} */
  let requests = [];

  const server = createServer(async (req, res) => {
    const path = (req.url ?? '').split('?')[0] ?? '';
    try {
      if (req.method === 'GET' && path === '/_control/requests') return send(res, 200, requests);
      if (req.method === 'POST' && path === '/_control/reset') {
        knobs.anthropic = defaults();
        knobs.deepseek = defaults();
        requests = [];
        return send(res, 200, { ok: true });
      }
      const control = /^\/_control\/(anthropic|deepseek)$/.exec(path);
      if (req.method === 'POST' && control) {
        const body = await readBody(req);
        if (body === null || typeof body !== 'object') return send(res, 400, { error: 'bad json' });
        const name = /** @type {string} */ (control[1]);
        knobs[name] = /** @type {Knobs} */ ({ ...knobs[name], ...body });
        return send(res, 200, { ok: true });
      }

      let provider = null;
      if (req.method === 'POST' && path === '/v1/messages') provider = 'anthropic';
      if (req.method === 'POST' && path === '/chat/completions') provider = 'deepseek';
      if (provider === null) return send(res, 404, { error: 'not found' });

      const body = /** @type {any} */ (await readBody(req));
      requests.push({ provider, path, headers: { ...req.headers }, body, at: Date.now() });
      if (requests.length > RING) requests = requests.slice(-RING);
      if (body === null) return send(res, 400, { error: 'bad json' });

      const k = /** @type {Knobs} */ (knobs[provider]);
      if (k.delayMs > 0) await sleep(k.delayMs);
      if (k.down !== null) return send(res, k.down, { error: { type: 'unavailable' } });
      if (k.errorRate > 0 && Math.random() < k.errorRate) return send(res, 500, { error: { type: 'fake_error' } });

      // `refuse`: the provider declines the content (security S1) — Anthropic answers 200 with
      // `stop_reason: "refusal"` and no text block; DeepSeek answers 400 "Content Exists Risk".
      if (k.refuse) {
        if (provider === 'anthropic') {
          return send(res, 200, { id: 'msg_fake', type: 'message', role: 'assistant', content: [], stop_reason: 'refusal', usage: defaultUsage(provider) });
        }
        return send(res, 400, { error: { message: 'Content Exists Risk', type: 'invalid_request_error', param: null, code: 'invalid_request_error' } });
      }

      /** @type {any[]} */
      const messages = Array.isArray(body.messages) ? body.messages : [];
      const user = [...messages].reverse().find((m) => m && m.role === 'user');
      const content = typeof user?.content === 'string' ? user.content : '';
      const system =
        provider === 'anthropic' ? String(body.system ?? '') : String(messages.find((m) => m && m.role === 'system')?.content ?? '');
      const text = delimited(content);
      const translating = /translat/i.test(system);

      let answer;
      if (k.corrupt === 'prose') answer = 'Sorry, this text cannot be rated.';
      else if (k.corrupt === 'empty') answer = '';
      else if (k.corrupt === 'out-of-range') answer = JSON.stringify({ score: 7 });
      else if (translating) answer = k.translation ?? text;
      else answer = JSON.stringify({ score: scoreFor(k.score, text) });

      const usage = k.usage === undefined ? defaultUsage(provider) : k.usage;
      const extra = usage === null ? {} : { usage };
      if (provider === 'anthropic') {
        return send(res, 200, { id: 'msg_fake', type: 'message', role: 'assistant', content: [{ type: 'text', text: answer }], ...extra });
      }
      return send(res, 200, { id: 'cmpl_fake', choices: [{ index: 0, message: { role: 'assistant', content: answer } }], ...extra });
    } catch {
      return send(res, 500, { error: 'fake failure' });
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
  const { url } = await startFakeAi({ port });
  process.stdout.write(`fake AI listening on ${url}\n`);
}
