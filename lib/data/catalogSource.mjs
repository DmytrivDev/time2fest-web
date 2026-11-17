// @ts-check
/**
 * Build-time catalog source (SPEC-04, AC-68/69/70). Runs in Node at build only (next.config), never in the site bundle:
 * the integration build (test + http) fetches `GET /api/catalog` and fails closed; a production http build does it only
 * when `T2F_CATALOG_URL` is set; everything else keeps reading `data/`. Node built-ins only: the response schema
 * (`CatalogResponseSchema` from `@time2fest/contracts/schemas`) is passed in by `next.config.ts`, so zod stays out of here.
 */
import fs from 'node:fs';
import path from 'node:path';

/**
 * @typedef {{ code?: string, path: ReadonlyArray<PropertyKey>, message: string, errors?: ReadonlyArray<ReadonlyArray<Issue>> }} Issue
 * @typedef {{ safeParse(value: unknown): { success: true, data: unknown } | { success: false, error: { issues: ReadonlyArray<Issue> } } }} ResponseSchema
 */

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

/** @param {string | undefined} text @returns {string | undefined} */
function portFromEnvFile(text) {
  const m = /^\s*T2F_SERVER_PORT\s*=\s*(\S+)\s*$/m.exec(text ?? '');
  return m?.[1]?.replace(/^["']|["']$/g, '');
}

/**
 * S4-03: the public site is built from this URL, so it must be `https:`; plain `http:` only to a loopback host and only in
 * a test build (the worktree server). Throws `catalog: T2F_CATALOG_URL …` otherwise; the message never repeats the path.
 * @param {string} raw @param {boolean} testBuild
 */
export function checkCatalogUrl(raw, testBuild) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    throw new Error('catalog: T2F_CATALOG_URL is not a valid URL');
  }
  if (u.protocol === 'https:') return;
  if (u.protocol === 'http:' && testBuild && LOOPBACK.has(u.hostname)) return;
  const allowed = testBuild ? 'https:, or http: to 127.0.0.1 / localhost / [::1]' : 'https: (http: is allowed only on loopback in a test build)';
  throw new Error(`catalog: T2F_CATALOG_URL must use ${allowed}; got ${u.protocol}//${u.host}`);
}

/**
 * @param {{ testBuild: boolean, apiMode: string, env: Record<string, string | undefined>, envFile?: string }} args
 *   `envFile`: path of `server/.env.local` (defaults to the one next to this worktree's `server/`).
 * @returns {'data' | { url: string }}
 */
export function resolveCatalogSource({ testBuild, apiMode, env, envFile = path.join(process.cwd(), 'server', '.env.local') }) {
  if (apiMode !== 'http') return 'data';
  if (env.T2F_CATALOG_URL) {
    checkCatalogUrl(env.T2F_CATALOG_URL, testBuild);
    return { url: env.T2F_CATALOG_URL.replace(/\/+$/, '') };
  }
  if (!testBuild) return 'data';
  let port = env.T2F_SERVER_PORT;
  if (!port && fs.existsSync(envFile)) port = portFromEnvFile(fs.readFileSync(envFile, 'utf8'));
  return { url: `http://127.0.0.1:${port ?? '4000'}` };
}

/**
 * The first issue, descending into a union: the branch that does not reject `ok` itself is the one the body was meant for.
 * @param {ReadonlyArray<Issue>} issues @param {PropertyKey[]} base
 * @returns {{ path: string, message: string }}
 */
export function firstIssue(issues, base = []) {
  const top = issues[0];
  if (!top) return { path: base.map(String).join('.') || '(root)', message: 'invalid' };
  const at = [...base, ...top.path];
  if (top.code === 'invalid_union' && top.errors?.length) {
    const rejectsOk = (/** @type {ReadonlyArray<Issue>} */ b) => b.some((i) => i.path.length === 1 && i.path[0] === 'ok');
    const branch = top.errors.find((b) => b.length > 0 && !rejectsOk(b)) ?? top.errors.find((b) => b.length > 0);
    if (branch) return firstIssue(branch, at);
  }
  return { path: at.map(String).join('.') || '(root)', message: top.message };
}

const CATALOG_TIMEOUT_MS = 30_000;
const CATALOG_MAX_BYTES = 10 * 1024 * 1024;

/**
 * Reads the body as text and stops past `max` bytes (the declared length may be absent or a lie).
 * @param {Response} res @param {number} max @param {(why: string) => Error} fail
 */
async function readCapped(res, max, fail) {
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
      await reader.cancel().catch(() => {});
      throw fail('too-large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * GET `<url>/api/catalog`, validate the whole body with `schema` (`CatalogResponseSchema`), require `ok: true`, write
 * `schedule.json` and `countries.json` into `dir`. Any failure throws `catalog: <url>/api/catalog → <why>` (an invalid
 * body names its first failing path) and writes nothing; there is no fallback.
 * @param {string} dir @param {string} url @param {ResponseSchema} schema
 * @returns {Promise<{ version: string }>}
 */
export async function fetchCatalogTo(dir, url, schema) {
  const endpoint = `${url.replace(/\/+$/, '')}/api/catalog`;
  // N-3: messages and the log name only origin + fixed path (no userinfo, no query).
  const shown = `${new URL(endpoint).origin}/api/catalog`;
  /** @param {string} why */
  const fail = (why) => new Error(`catalog: ${shown} → ${why}`);
  let res;
  try {
    // N-1: no redirects (they could leave https / the allowed host), 30 s cap.
    res = await fetch(endpoint, { headers: { accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(CATALOG_TIMEOUT_MS) });
  } catch (e) {
    const err = /** @type {{ name?: string, code?: string, cause?: { code?: string }, message?: string }} */ (e);
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw fail('timeout');
    if (err.cause?.code || err.code) throw fail(err.cause?.code ?? err.code ?? 'unreachable');
    throw fail(/redirect/i.test(err.message ?? '') || /redirect/i.test(String(/** @type {{ message?: string }} */ (err.cause)?.message ?? '')) ? 'redirect refused' : (err.message ?? 'unreachable'));
  }
  /** @type {unknown} */
  let body;
  try {
    const declared = Number(res.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > CATALOG_MAX_BYTES) throw fail('too-large');
    body = JSON.parse(await readCapped(res, CATALOG_MAX_BYTES, fail));
  } catch (e) {
    if (e instanceof Error && e.message.startsWith('catalog: ')) throw e;
    if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw fail('timeout');
    throw fail(res.ok ? 'bad-response' : String(res.status));
  }
  if (!res.ok) throw fail(String(res.status));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const { path: at, message } = firstIssue(parsed.error.issues);
    throw fail(`invalid response at ${at}: ${message}`);
  }
  // Validated; the bytes written are the server's own (the parsed copy may reorder keys).
  const valid = /** @type {{ ok: true, value: { version: string, schedule: unknown, countries: unknown } } | { ok: false, error: { code: string } }} */ (body);
  if (!valid.ok) throw fail(valid.error.code);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify(valid.value.schedule));
  fs.writeFileSync(path.join(dir, 'countries.json'), JSON.stringify(valid.value.countries));
  return { version: valid.value.version };
}
