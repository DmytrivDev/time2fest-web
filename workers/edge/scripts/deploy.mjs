// @ts-check
/**
 * Deploys the edge Worker to one environment (AC-13, NFR-3).
 *   node scripts/deploy.mjs --env <test|rehearsal|prelaunch|production> [--secrets-file <path>] [--confirm <env>] [--allow-main-domain]
 *     [--take-domain-from <worker-name|dns>]
 * Secrets travel only in the environment and the child's stdin, never in argv or output. Node built-ins only.
 *
 * Before deploying a main-domain env, the script checks who holds each route host now (F1): `wrangler deploy` silently
 * overrides an existing Custom Domain origin and DNS record. A host bound to another Worker, covered by another
 * Worker's zone route, or with a non-Worker A/AAAA/CNAME record, is refused (exit 2) unless `--take-domain-from`
 * names that holder exactly. A Worker-looking record (read-only, `AAAA 100::`) counts as a Worker's only when the
 * host has a Custom Domain binding; otherwise its holder is `dns`. The check needs `CLOUDFLARE_ZONE_ID` and a token
 * that can read Workers Custom Domains, the zone's DNS records and the zone's Worker routes; if any is missing the
 * deploy is refused with a message naming it — the check is never skipped. Same rule as
 * `infra/ops/lib/domainHolder.mjs` (duplicated on purpose: this package does not import from `infra/ops`;
 * `infra/ops/test/parity.test.mjs` runs both copies through the same scenarios).
 */
import { spawn as nodeSpawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WRANGLER_JS = path.resolve(PKG, '..', '..', 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const ENVS = ['test', 'rehearsal', 'prelaunch', 'production'];
/** Environments whose routes claim the main domain: they need `--allow-main-domain` as well. */
export const MAIN_DOMAIN_ENVS = ['prelaunch', 'production'];
const MIN_SECRET = 32;
const CF_API = 'https://api.cloudflare.com/client/v4';
/** `--take-domain-from` value for DNS records that belong to no Worker. */
export const TAKE_FROM_DNS = 'dns';
export const RIGHT_WORKERS_READ = 'Account > Workers Scripts > Read (Custom Domain bindings)';
export const RIGHT_DNS_READ = 'Zone > DNS > Read (records of the main-domain zone)';
export const RIGHT_ROUTES_READ = 'Zone > Workers Routes > Read (Worker routes of the zone)';
export const ADDRESS_TYPES = ['A', 'AAAA', 'CNAME'];
const RE_HOLDER = /^(dns|[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/;

/** @param {string} s */
const norm = (s) => String(s).trim().toLowerCase().replace(/\.$/, '');

/** A DNS record that looks created by a Worker Custom Domain (ours only together with a binding). @param {any} r */
const isWorkerRecord = (r) =>
  r?.meta?.read_only === true || typeof r?.meta?.origin_worker_id === 'string' || (r?.type === 'AAAA' && r?.content === '100::');

/** Does a Worker route pattern cover the host: `host/*`, `*.domain/*`, `*domain/*`. @param {unknown} pattern @param {string} host */
const routeCoversHost = (pattern, host) => {
  const p = norm(String(pattern ?? '').replace(/^[a-z]+:\/\//i, '').split('/')[0]?.replace(/:\d+$/, '') ?? '');
  if (!p) return false;
  return p === host || (p.startsWith('*') && host.endsWith(p.slice(1)));
};

/**
 * Who holds each route host now (F1). Never skipped: a missing zone id, a missing right or a failed read refuses.
 * @param {{
 *   fetch: typeof globalThis.fetch,
 *   token: string,
 *   account: string,
 *   zone: string | undefined,
 *   hosts: string[],
 *   worker: string,
 *   takeFrom?: string,
 * }} o
 * @returns {Promise<{ ok: true, taken: string[] } | { ok: false, message: string }>}
 */
export async function checkDomainHolders(o) {
  if (!o.zone) return { ok: false, message: 'missing CLOUDFLARE_ZONE_ID (zone of the main domain): the holder check is never skipped' };
  if (!o.hosts.length) return { ok: false, message: 'the env has no route hosts to check' };
  /** @param {string} url @returns {Promise<{ ok: boolean, status: number, result: any[] }>} */
  const get = async (url) => {
    try {
      const res = await o.fetch(url, { method: 'GET', headers: { Authorization: `Bearer ${o.token}`, Accept: 'application/json' } });
      /** @type {any} */
      let body = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const ok = res.ok && body?.success !== false && Array.isArray(body?.result);
      return { ok, status: res.status, result: ok ? body.result : [] };
    } catch {
      return { ok: false, status: 0, result: [] };
    }
  };
  /** @param {{ status: number }} r @param {string} right @param {string} what */
  const failed = (r, right, what) =>
    r.status === 401 || r.status === 403
      ? `${what}: the token lacks ${right}; the holder check is never skipped`
      : `${what}: Cloudflare answered ${r.status === 0 ? 'nothing (network)' : `HTTP ${r.status}`}; the holder check is never skipped`;
  const self = norm(o.worker);
  /** @type {Set<string>} */
  const taken = new Set();
  const routes = await get(`${CF_API}/zones/${encodeURIComponent(o.zone)}/workers/routes`);
  if (!routes.ok) return { ok: false, message: failed(routes, RIGHT_ROUTES_READ, 'Worker routes of the zone') };
  for (const host of o.hosts.map(norm)) {
    /** @type {Set<string>} */
    const holders = new Set();
    let bound = false;
    const b = await get(`${CF_API}/accounts/${encodeURIComponent(o.account)}/workers/domains?hostname=${encodeURIComponent(host)}`);
    if (!b.ok) return { ok: false, message: failed(b, RIGHT_WORKERS_READ, `${host}: Custom Domain bindings`) };
    for (const d of b.result) {
      if (norm(String(d?.hostname ?? host)) !== host) continue;
      bound = true;
      const service = norm(String(d?.service ?? ''));
      if (service !== self) holders.add(service || 'unknown Worker');
    }
    const r = await get(`${CF_API}/zones/${encodeURIComponent(o.zone)}/dns_records?name=${encodeURIComponent(host)}&per_page=100`);
    if (!r.ok) return { ok: false, message: failed(r, RIGHT_DNS_READ, `${host}: DNS records`) };
    for (const rec of r.result) {
      if (norm(String(rec?.name ?? '')) !== host || !ADDRESS_TYPES.includes(String(rec?.type))) continue;
      // A Worker-looking record with no binding for this host is tied to no Worker: holder `dns`.
      if (!isWorkerRecord(rec) || !bound) holders.add(TAKE_FROM_DNS);
    }
    for (const rt of routes.result) {
      if (!routeCoversHost(rt?.pattern, host)) continue;
      const script = norm(String(rt?.script ?? ''));
      if (script && script !== self) holders.add(script);
    }
    if (holders.size === 0) continue;
    const list = [...holders].sort().join(', ');
    if (o.takeFrom === undefined) {
      return { ok: false, message: `${host} is held by ${list}; deploying would take it — only with --take-domain-from <holder>` };
    }
    if (holders.size !== 1 || !holders.has(norm(o.takeFrom))) {
      return { ok: false, message: `${host} is held by ${list}, but --take-domain-from names ${o.takeFrom}` };
    }
    taken.add(norm(o.takeFrom));
  }
  if (o.takeFrom !== undefined && taken.size === 0) {
    return { ok: false, message: `--take-domain-from ${o.takeFrom}: it holds none of ${o.hosts.join(', ')}` };
  }
  return { ok: true, taken: [...taken] };
}

/** @param {string[]} argv @param {string} name */
const flag = (argv, name) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
};

/**
 * Runs one wrangler child; resolves with its exit code. `input` goes to stdin.
 * @param {typeof nodeSpawn} spawn @param {string[]} args @param {NodeJS.ProcessEnv} env
 * @param {(s: string) => void} out @param {string} [input]
 * @returns {Promise<number>}
 */
function runChild(spawn, args, env, out, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [WRANGLER_JS, ...args], {
      shell: false,
      env,
      cwd: PKG,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', (d) => out(String(d)));
    child.stderr?.on('data', (d) => out(String(d)));
    child.on('error', () => resolve(1));
    child.on('close', (code) => resolve(code ?? 1));
    if (input !== undefined) child.stdin?.write(input);
    child.stdin?.end();
  });
}

/**
 * @param {string[]} argv
 * @param {{
 *   spawn?: typeof nodeSpawn,
 *   env?: NodeJS.ProcessEnv,
 *   out?: (s: string) => void,
 *   err?: (s: string) => void,
 *   loadEnvFile?: (p: string) => void,
 *   assetsDir?: string,
 *   fetch?: typeof globalThis.fetch,
 * }} [deps] `assetsDir` overrides the env's assets directory (tests); `fetch` — Cloudflare API (tests inject a fake).
 * @returns {Promise<number>} exit code
 */
export async function deploy(argv, deps = {}) {
  const spawn = deps.spawn ?? nodeSpawn;
  const env = deps.env ?? process.env;
  const out = deps.out ?? ((s) => process.stdout.write(s));
  const err = deps.err ?? ((s) => process.stderr.write(s));
  const target = flag(argv, '--env');
  const takeFrom = flag(argv, '--take-domain-from')?.toLowerCase();
  const secretsFile = flag(argv, '--secrets-file');
  if (secretsFile) (deps.loadEnvFile ?? process.loadEnvFile.bind(process))(secretsFile);
  if (!target || !ENVS.includes(target)) {
    err(`unknown or missing --env (one of ${ENVS.join(', ')})\n`);
    return 1;
  }
  if (target !== 'test' && flag(argv, '--confirm') !== target) {
    err(`not deployed in this wave: ${target} needs --confirm ${target}\n`);
    return 2;
  }
  // prelaunch and production routes claim time2fest.com: a second, explicit flag (AC-21).
  if (MAIN_DOMAIN_ENVS.includes(target) && !argv.includes('--allow-main-domain')) {
    err(`refused: ${target} needs --confirm ${target} and --allow-main-domain\n`);
    return 2;
  }
  if (argv.includes('--take-domain-from') && (takeFrom === undefined || !RE_HOLDER.test(takeFrom))) {
    err('--take-domain-from: expected dns or a Worker name\n');
    return 2;
  }
  const cfg = JSON.parse(fs.readFileSync(path.join(PKG, 'wrangler.json'), 'utf8'));
  const block = cfg.env[target];
  const proxy = Boolean(block.vars && 'ORIGIN_URL' in block.vars);
  const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', ...(proxy ? ['T2F_EDGE_SECRET'] : [])];
  const missing = required.filter((n) => !env[n]);
  const secret = env.T2F_EDGE_SECRET;
  if (proxy && secret && secret.length < MIN_SECRET) missing.push(`T2F_EDGE_SECRET (shorter than ${MIN_SECRET} characters)`);
  if (missing.length) {
    err(`missing: ${missing.join(', ')}\n`);
    return 1;
  }
  const assets = deps.assetsDir ?? path.resolve(PKG, block.assets.directory);
  if (!fs.existsSync(assets) || fs.readdirSync(assets).length === 0) {
    err(`assets directory is missing or empty: ${path.basename(assets)}\n`);
    return 1;
  }
  if (MAIN_DOMAIN_ENVS.includes(target)) {
    const held = await checkDomainHolders({
      fetch: deps.fetch ?? globalThis.fetch,
      token: String(env.CLOUDFLARE_API_TOKEN),
      account: String(env.CLOUDFLARE_ACCOUNT_ID),
      zone: env.CLOUDFLARE_ZONE_ID,
      hosts: (block.routes ?? []).map((/** @type {{ pattern: string }} */ r) => r.pattern),
      worker: String(block.name ?? `${cfg.name}-${target}`),
      takeFrom,
    });
    if (!held.ok) {
      err(`refused: ${held.message}\n`);
      return 2;
    }
    if (held.taken.length) out(`taking the name from ${held.taken.join(', ')} (--take-domain-from)\n`);
  }
  let code = await runChild(spawn, ['deploy', '--env', target], env, out);
  if (code !== 0) return code;
  if (proxy) {
    code = await runChild(spawn, ['secret', 'put', 'T2F_EDGE_SECRET', '--env', target], env, out, `${secret}\n`);
    if (code !== 0) return code;
  }
  out(`deployed ${target}\n`);
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await deploy(process.argv.slice(2));
}
