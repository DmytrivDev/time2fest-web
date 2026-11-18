// @ts-check
// Worker краю (AC-14, AC-20, AC-24, AC-31): `process.execPath <wrangler.js> … --env <workerEnv>` у `workers/edge`,
// збірка сайту `test`+`http` для репетиції. Облікові дані — лише в середовищі дитини; значення секрету — лише на stdin.
// `putSecret` викликають тільки команди секретів (W22/W23): розгортання й відкат його не імпортують (AC-20).
import fs from 'node:fs';
import path from 'node:path';
import { NODE_TOOLS, REPO_ROOT, run as realRun } from './exec.mjs';
import { ENVS } from './config.mjs';

export const EDGE_DIR = path.join(REPO_ROOT, 'workers', 'edge');
export const WRANGLER_JS = path.join(REPO_ROOT, NODE_TOOLS.wrangler);
export const NEXT_JS = path.join(REPO_ROOT, NODE_TOOLS.next);
export const ROLLBACK_MESSAGE = 't2f rollback';

const STATUS_TIMEOUT_MS = 2 * 60_000;
const DEPLOY_TIMEOUT_MS = 10 * 60_000;
const BUILD_TIMEOUT_MS = 30 * 60_000;
/** Версія Worker’а — UUID. */
const RE_VERSION = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const RE_SECRET_NAME = /^[A-Z][A-Z0-9_]{0,63}$/;
/** Worker’а ще немає або в нього немає розгортань (`wrangler deployments status`). */
const RE_NO_WORKER = /has no deployments|does not exist|\b10007\b|workers?\.api\.error\.script_not_found/i;

/**
 * @typedef {import('./exec.mjs').RunOpts} RunOpts
 * @typedef {import('./exec.mjs').RunResult} RunResult
 * @typedef {(file: string, args: string[], opts?: RunOpts) => Promise<RunResult>} Runner
 * @typedef {{ code: 0, version: string | null } | { code: 1, message: string }} VersionResult
 * @typedef {{ code: 0 } | { code: 1, message: string }} StepResult
 */

/**
 * Версія з виводу `wrangler deployments status --json` (об’єкт останнього розгортання): `versions[0].version_id`.
 * @param {string} stdout
 * @returns {string | null}
 */
export function parseDeploymentStatus(stdout) {
  const s = String(stdout);
  const from = s.indexOf('{');
  const to = s.lastIndexOf('}');
  if (from < 0 || to < from) return null;
  try {
    const id = JSON.parse(s.slice(from, to + 1))?.versions?.[0]?.version_id;
    return typeof id === 'string' && RE_VERSION.test(id) ? id.toLowerCase() : null;
  } catch {
    return null;
  }
}

/**
 * Каталог статики середовища з `workers/edge/wrangler.json` (`env.<workerEnv>.assets.directory`).
 * @param {string} workerEnv
 * @returns {string | null}
 */
export function assetsDirOf(workerEnv) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(EDGE_DIR, 'wrangler.json'), 'utf8'));
    const dir = cfg?.env?.[workerEnv]?.assets?.directory;
    return typeof dir === 'string' ? path.resolve(EDGE_DIR, dir) : null;
  } catch {
    return null;
  }
}

/**
 * Ім’я Worker’а й хости його маршрутів з `workers/edge/wrangler.json` (`env.<workerEnv>`; ім’я за правилом wrangler —
 * `<name>-<env>`, якщо в середовища немає власного). `null` — конфіг не прочитано чи середовища немає.
 * @param {string} workerEnv
 * @returns {{ name: string, hosts: string[] } | null}
 */
export function workerRoutesOf(workerEnv) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(EDGE_DIR, 'wrangler.json'), 'utf8'));
    const block = cfg?.env?.[workerEnv];
    if (!block) return null;
    const name = String(block.name ?? `${cfg.name}-${workerEnv}`);
    const hosts = (Array.isArray(block.routes) ? block.routes : []).map((/** @type {{ pattern: string }} */ r) => String(r.pattern).toLowerCase());
    return { name, hosts };
  } catch {
    return null;
  }
}

/**
 * Змінні збірки сайту середовища: `buildEnv` + `NEXT_DIST_DIR` (ті самі прапорці, що `build:edge:rehearsal`).
 * @param {string} env
 * @returns {Record<string, string> | null} `null` — у середовища немає збірки (prelaunch, production)
 */
export function siteBuildEnv(env) {
  const cfg = ENVS[env];
  if (!cfg?.buildEnv || !cfg.distDir) return null;
  return { ...cfg.buildEnv, NEXT_DIST_DIR: cfg.distDir };
}

/**
 * @param {{
 *   env: string,
 *   processEnv: Record<string, string | undefined>,
 *   run?: Runner,
 *   out?: (line: string) => void,
 *   assetsDir?: string,
 * }} o `processEnv` — середовище з `--secrets-file` (облікові дані Cloudflare); `out` — уже маскований вивід ops;
 *   `assetsDir` — інший каталог статики (тести)
 */
export function createWorker(o) {
  const cfg = ENVS[o.env];
  if (!cfg) throw new TypeError('worker: невідоме середовище');
  const workerEnv = cfg.workerEnv;
  const run = o.run ?? realRun;
  const out = o.out ?? (() => {});
  /** @type {NodeJS.ProcessEnv} */
  const childEnv = { ...o.processEnv };

  /** @param {'stdout' | 'stderr'} _s @param {string} line */
  const onLine = (_s, line) => out(`  ${line}`);

  /** @param {string[]} args @param {RunOpts} [opts] */
  const wrangler = (args, opts = {}) =>
    run(process.execPath, [WRANGLER_JS, ...args, '--env', workerEnv], { cwd: EDGE_DIR, env: childEnv, ...opts });

  /** @returns {Promise<VersionResult>} */
  async function currentVersion() {
    const r = await wrangler(['deployments', 'status', '--json'], { timeoutMs: STATUS_TIMEOUT_MS });
    if (r.code !== 0) {
      if (RE_NO_WORKER.test(`${r.stdout}\n${r.stderr}`)) return { code: 0, version: null };
      return { code: 1, message: `wrangler deployments status завершився з кодом ${r.code}` };
    }
    const version = parseDeploymentStatus(r.stdout);
    return version ? { code: 0, version } : { code: 1, message: 'wrangler deployments status: у відповіді немає версії' };
  }

  return {
    workerEnv,
    currentVersion,

    /** Облікові дані для wrangler є (до будь-якої зміни). @returns {string[]} назви відсутніх змінних */
    missingCredentials: () => ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID'].filter((n) => !o.processEnv[n]),

    /** Чи готова статика для середовища без власної збірки (prelaunch: `out-prelaunch` не порожній). */
    assetsReady() {
      const dir = o.assetsDir ?? assetsDirOf(workerEnv);
      return dir !== null && fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
    },

    /** Чи середовище збирає сайт саме (репетиція). */
    hasBuild: () => siteBuildEnv(o.env) !== null,

    /**
     * `next build` у `test`+`http` у теку середовища (AC-31). `T2F_CATALOG_URL` — зі змінної або `https://<siteHost>`.
     * @returns {Promise<StepResult>}
     */
    async buildSite() {
      const vars = siteBuildEnv(o.env);
      if (!vars) return { code: 1, message: `для ${o.env} збірки сайту немає` };
      const catalog = o.processEnv.T2F_CATALOG_URL || (cfg.siteHost ? `https://${cfg.siteHost}` : '');
      const r = await run(process.execPath, [NEXT_JS, 'build'], {
        cwd: REPO_ROOT,
        env: { ...childEnv, ...vars, ...(catalog ? { T2F_CATALOG_URL: catalog } : {}) },
        timeoutMs: BUILD_TIMEOUT_MS,
        onLine,
      });
      return r.code === 0 ? { code: 0 } : { code: 1, message: `next build завершився з кодом ${r.code}` };
    },

    /**
     * `wrangler deploy --env <workerEnv>`, потім нова версія. Секретів не пише (AC-20).
     * @returns {Promise<VersionResult>}
     */
    async deploy() {
      const r = await wrangler(['deploy'], { timeoutMs: DEPLOY_TIMEOUT_MS, onLine });
      if (r.code !== 0) return { code: 1, message: `wrangler deploy завершився з кодом ${r.code}` };
      const v = await currentVersion();
      if (v.code === 0 && v.version === null) return { code: 1, message: 'після wrangler deploy версія Worker’а невідома' };
      return v;
    },

    /**
     * `wrangler rollback <version> -m "t2f rollback" -y`.
     * @param {string} versionId
     * @returns {Promise<StepResult>}
     */
    async rollback(versionId) {
      if (!RE_VERSION.test(versionId)) return { code: 1, message: 'версія Worker’а має бути UUID' };
      const r = await wrangler(['rollback', versionId, '-m', ROLLBACK_MESSAGE, '-y'], { timeoutMs: DEPLOY_TIMEOUT_MS, onLine });
      return r.code === 0 ? { code: 0 } : { code: 1, message: `wrangler rollback завершився з кодом ${r.code}` };
    },

    /**
     * `wrangler secret put <name>`: значення — лише на stdin, ніколи в argv чи вивід. Лише для `secrets.mjs`.
     * @param {string} name
     * @param {string} value
     * @returns {Promise<StepResult>}
     */
    async putSecret(name, value) {
      if (!RE_SECRET_NAME.test(name)) return { code: 1, message: 'недопустима назва секрету' };
      if (typeof value !== 'string' || value === '' || /[\r\n]/.test(value)) return { code: 1, message: `${name}: недопустиме значення` };
      const r = await wrangler(['secret', 'put', name], { input: `${value}\n`, timeoutMs: DEPLOY_TIMEOUT_MS });
      return r.code === 0 ? { code: 0 } : { code: 1, message: `wrangler secret put ${name} завершився з кодом ${r.code}` };
    },
  };
}

/** @typedef {ReturnType<typeof createWorker>} Worker */
