// @ts-check
/**
 * Health probe of the server (SPEC-13a AC-5, AC-13, AC-54), runnable inside the image:
 *   node scripts/health-probe.mjs [--url <u>] [--secret current|previous|none|wrong] [--raw]
 * Default URL `http://127.0.0.1:${T2F_SERVER_PORT}/api/health`. `--secret current` (default) sends
 * `T2F_EDGE_SECRET` and `previous` sends `T2F_EDGE_SECRET_PREVIOUS`, both read from this process's
 * own environment only (never from argv); an unset value sends no header. `none` sends no header,
 * `wrong` 32 random bytes. The secret is never printed.
 * Prints `<status> <commit|->`; with `--raw` the status, the sorted response headers and the body.
 * Exit 0 only on a 200; 1 on any other answer or no answer; 2 on a usage error (also for a URL that
 * is not `http://` to a single-label host or loopback: the probe never leaves the node's network).
 */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const TIMEOUT_MS = 5_000;
const COMMIT = /^[0-9a-f]{40}$/;
const SECRET_MODES = new Set(['current', 'previous', 'none', 'wrong']);

/**
 * @param {string[]} argv
 * @returns {{ url?: string, secret: string, raw: boolean } | { error: string }}
 */
export function parseProbeArgs(argv) {
  /** @type {{ url?: string, secret: string, raw: boolean }} */
  const out = { secret: 'current', raw: false };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === '--raw') out.raw = true;
    else if (a === '--url' || a === '--secret') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} needs a value` };
      if (a === '--url') out.url = v;
      else if (!SECRET_MODES.has(v)) return { error: '--secret must be current, previous, none or wrong' };
      else out.secret = v;
      i += 1;
    } else return { error: `unknown argument ${a}` };
  }
  return out;
}

/**
 * True when `raw` is an `http://` URL to a single-label host (a Compose service name) or loopback.
 * @param {string} raw
 * @returns {boolean}
 */
export function isLocalHttpUrl(raw) {
  let u;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' || u.username !== '' || u.password !== '') return false;
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host === '[::1]' || /^127(\.\d{1,3}){3}$/.test(host)) return true;
  return /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/.test(host);
}

/**
 * @param {string} mode
 * @param {Record<string, string | undefined>} env
 * @returns {string | undefined} the value of `x-t2f-edge`, or undefined for no header
 */
function edgeHeader(mode, env) {
  if (mode === 'wrong') return randomBytes(32).toString('hex');
  if (mode === 'current') return env.T2F_EDGE_SECRET || undefined;
  if (mode === 'previous') return env.T2F_EDGE_SECRET_PREVIOUS || undefined;
  return undefined;
}

/**
 * @param {string[]} argv
 * @param {{ env: Record<string, string | undefined>, out: (s: string) => void, err: (s: string) => void, fetch: typeof fetch }} deps
 * @returns {Promise<number>}
 */
export async function main(argv, deps) {
  const args = parseProbeArgs(argv);
  if ('error' in args) {
    deps.err(`health-probe: ${args.error}`);
    return 2;
  }
  let url = args.url;
  if (url === undefined) {
    const port = deps.env.T2F_SERVER_PORT;
    if (!port || !/^\d{1,5}$/.test(port)) {
      deps.err('health-probe: T2F_SERVER_PORT is not set');
      return 2;
    }
    url = `http://127.0.0.1:${port}/api/health`;
  }
  if (!isLocalHttpUrl(url)) {
    deps.err('health-probe: --url must be http:// to a single-label host or loopback');
    return 2;
  }
  const edge = edgeHeader(args.secret, deps.env);
  /** @type {Response} */
  let res;
  try {
    res = await deps.fetch(url, {
      headers: edge === undefined ? {} : { 'x-t2f-edge': edge },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    deps.out('000 -');
    return 1;
  }
  const body = await res.text().catch(() => '');
  if (args.raw) {
    deps.out(String(res.status));
    const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
    for (const [k, v] of headers) deps.out(`${k}: ${v}`);
    deps.out('');
    deps.out(body);
  } else {
    let commit = '-';
    try {
      const parsed = /** @type {{ commit?: unknown }} */ (JSON.parse(body));
      if (typeof parsed.commit === 'string' && COMMIT.test(parsed.commit)) commit = parsed.commit;
    } catch {
      // not JSON: no commit to show
    }
    deps.out(`${res.status} ${commit}`);
  }
  return res.status === 200 ? 0 : 1;
}

const isEntry = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntry) {
  main(process.argv.slice(2), {
    env: process.env,
    out: (s) => console.log(s),
    err: (s) => console.error(s),
    fetch: globalThis.fetch,
  }).then((code) => process.exit(code));
}
