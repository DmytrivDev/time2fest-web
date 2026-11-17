// @ts-check
/**
 * Build-time catalog source (SPEC-04, AC-68/69/70). Runs in Node at build only (next.config), never in the site bundle:
 * the integration build (test + http) fetches `GET /api/catalog` and fails closed; a production http build does it only
 * when `T2F_CATALOG_URL` is set; everything else keeps reading `data/`. Node built-ins only.
 */
import fs from 'node:fs';
import path from 'node:path';

/** @param {string | undefined} text @returns {string | undefined} */
function portFromEnvFile(text) {
  const m = /^\s*T2F_SERVER_PORT\s*=\s*(\S+)\s*$/m.exec(text ?? '');
  return m?.[1]?.replace(/^["']|["']$/g, '');
}

/**
 * @param {{ testBuild: boolean, apiMode: string, env: Record<string, string | undefined>, envFile?: string }} args
 *   `envFile`: path of `server/.env.local` (defaults to the one next to this worktree's `server/`).
 * @returns {'data' | { url: string }}
 */
export function resolveCatalogSource({ testBuild, apiMode, env, envFile = path.join(process.cwd(), 'server', '.env.local') }) {
  if (apiMode !== 'http') return 'data';
  if (env.T2F_CATALOG_URL) return { url: env.T2F_CATALOG_URL.replace(/\/+$/, '') };
  if (!testBuild) return 'data';
  let port = env.T2F_SERVER_PORT;
  if (!port && fs.existsSync(envFile)) port = portFromEnvFile(fs.readFileSync(envFile, 'utf8'));
  return { url: `http://127.0.0.1:${port ?? '4000'}` };
}

/**
 * GET `<url>/api/catalog`, require `ok: true`, write `schedule.json` and `countries.json` into `dir`.
 * Any failure throws `catalog: <url>/api/catalog → <status|code>`; there is no fallback.
 * @param {string} dir @param {string} url
 * @returns {Promise<{ version: string }>}
 */
export async function fetchCatalogTo(dir, url) {
  const endpoint = `${url.replace(/\/+$/, '')}/api/catalog`;
  /** @param {string} why */
  const fail = (why) => new Error(`catalog: ${endpoint} → ${why}`);
  let res;
  try {
    res = await fetch(endpoint, { headers: { accept: 'application/json' } });
  } catch (e) {
    const err = /** @type {{ code?: string, cause?: { code?: string }, message?: string }} */ (e);
    throw fail(err.cause?.code ?? err.code ?? err.message ?? 'unreachable');
  }
  /** @type {any} */
  let body = null;
  try {
    body = await res.json();
  } catch {
    // handled below
  }
  if (!res.ok || !body || body.ok !== true) {
    throw fail(res.ok ? (body?.error?.code ?? 'bad-response') : String(res.status));
  }
  const value = body.value;
  if (!value || typeof value.version !== 'string' || !value.schedule || !value.countries) throw fail('bad-response');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'schedule.json'), JSON.stringify(value.schedule));
  fs.writeFileSync(path.join(dir, 'countries.json'), JSON.stringify(value.countries));
  return { version: value.version };
}
