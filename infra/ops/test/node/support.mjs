// @ts-check
// Спільна обв’язка набору локального вузла (SPEC-13a W32, W33): справжній Docker і локальний транспорт ops,
// фейковий Worker (без wrangler і мережі), проєкт Compose `t2f-node-rehearsal` (ніколи `t2f`), без портів на хості.
// Каталог стану — git-ignored `infra/ops/.local/node-suite-<назва>-<pid>/`, тож справжня перевірка
// `git check-ignore` для шляхів секретів на Windows проходить без підміни платформи.
//
// Скорочення тесту (без комітів): похідні образи — `FROM <базовий образ HEAD>` + `ENV T2F_COMMIT=<синтетичний SHA>`
// з тегом `t2f-server:<синтетичний SHA>`. Для них порт `git` визнає синтетичний SHA комітом, а `git show <синтетичний>:…`
// читає дерево базового коміту. `assertClean` — завжди «чисто» (файли набору під час розробки не закомічені).
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { main } from '../../ops.mjs';
import { REPO_ROOT, SHA40, localTransport, run, start } from '../../lib/exec.mjs';
import { createGit } from '../../lib/git.mjs';
import { parseJournal } from '../../lib/journal.mjs';
import { SYSTEM_CLOCK } from '../../lib/node.mjs';
import { getVar, setVar } from '../../lib/secrets/envFile.mjs';

export const ENV = 'rehearsal';
export const PROJECT = 't2f-node-rehearsal';
/** Мережа зонда — та, що cloudflared ділить лише із сервером (S1: cloudflared не в `backend`). */
export const NETWORK = `${PROJECT}_tunnel`;
const LABEL = `label=com.docker.compose.project=${PROJECT}`;
const NODE_DIR_NAME = `node-local-${ENV}`;
const DOCKER_TIMEOUT_MS = 10 * 60_000;
const PROBE_TIMEOUT_MS = 30_000;

/**
 * Значення-заглушки Access/R2 для класу `rehearsal`: проходять схему й заборонний список, ні з чим не з’єднуються.
 * @type {Record<string, string>}
 */
const PLACEHOLDERS = {
  T2F_ACCESS_AUD: 'local',
  T2F_ACCESS_TEAM_DOMAIN: 'https://t2f-local.cloudflareaccess.com',
  T2F_ACCESS_JWKS_URL: 'https://t2f-local.cloudflareaccess.com/cdn-cgi/access/certs',
  T2F_ADMIN_HOST: 'admin-rehearsal.time2fest.com',
  T2F_OWNER_EMAILS: 'owner@example.test',
  T2F_R2_ACCESS_KEY_ID: 'local-placeholder-key-id', // check-secrets: allow placeholder, never contacted
  T2F_R2_SECRET_ACCESS_KEY: 'local-placeholder-secret', // check-secrets: allow placeholder, never contacted
  T2F_R2_BUCKET: 't2f-node-suite',
  T2F_R2_ENDPOINT: 'https://r2.invalid',
  T2F_R2_PREFIX: 'node_suite/',
};

/**
 * `docker <args>` без оболонки.
 * @param {string[]} args
 * @param {import('../../lib/exec.mjs').RunOpts} [opts]
 */
export const docker = (args, opts = {}) => run('docker', args, { timeoutMs: DOCKER_TIMEOUT_MS, ...opts });

/** @param {number} ms */
export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Синтетичний 40-hex SHA (не коміт репозиторію). @param {string} seed */
export const syntheticSha = (seed) => crypto.createHash('sha1').update(`t2f-node-suite:${seed}`).digest('hex');

/** @param {string} file */
export const sha256File = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');

/**
 * Фейковий Worker: записує виклики, версії — UUID за лічильником.
 */
export function fakeWorker() {
  let n = 0;
  /** @param {number} i */
  const version = (i) => `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
  let current = version(0);
  const state = {
    /** Змінні виклики (deploy, rollback, putSecret) по порядку. @type {string[]} */
    calls: /** @type {string[]} */ ([]),
    /** Значення, надіслані `putSecret` (лише в пам’яті тесту). @type {string[]} */
    secrets: /** @type {string[]} */ ([]),
    current: () => current,
  };
  /** @param {string} workerEnv */
  const port = (workerEnv) => ({
    workerEnv,
    currentVersion: async () => ({ code: /** @type {const} */ (0), version: current }),
    missingCredentials: () => /** @type {string[]} */ ([]),
    assetsReady: () => true,
    hasBuild: () => false,
    buildSite: async () => ({ code: /** @type {const} */ (0) }),
    checkBundle: async () => ({ code: /** @type {const} */ (0) }),
    async deploy() {
      n += 1;
      current = version(n);
      state.calls.push(`deploy ${current}`);
      return { code: /** @type {const} */ (0), version: current };
    },
    /** @param {string} v */
    async rollback(v) {
      state.calls.push(`rollback ${v}`);
      current = v;
      return { code: /** @type {const} */ (0) };
    },
    /** @param {string} name @param {string} value */
    async putSecret(name, value) {
      state.calls.push(`putSecret ${name}`);
      state.secrets.push(value);
      return { code: /** @type {const} */ (0) };
    },
  });
  return { ...state, port };
}

/**
 * Обв’язка одного файлу набору.
 * @param {string} name коротка назва файлу (`deploy`, `failure`)
 */
export function createSuite(name) {
  const stateRoot = path.join(REPO_ROOT, 'infra', 'ops', '.local', `node-suite-${name}-${process.pid}`);
  const nodeDir = path.join(stateRoot, NODE_DIR_NAME);
  const localDir = path.join(stateRoot, ENV);
  const baseAlias = `t2f-node-suite-base:${name}`;
  const helper = `t2f-node-suite-probe-${name}`;
  /** Синтетичний SHA → базовий коміт (для `git show`). @type {Map<string, string>} */
  const aliases = new Map();
  /** Теги `t2f-server:<sha>`, створені набором. @type {Set<string>} */
  const createdTags = new Set();
  const worker = fakeWorker();
  let base = '';
  let baseExisted = true;
  let helperUp = false;

  /** @type {import('../../lib/exec.mjs').Executor['run']} */
  const aliasedRun = (file, args, opts) => {
    if (file === 'git' && args[0] === 'show' && typeof args[1] === 'string') {
      const i = args[1].indexOf(':');
      const ref = args[1].slice(0, i);
      const to = aliases.get(ref);
      if (to) args = ['show', `${to}:${args[1].slice(i + 1)}`, ...args.slice(2)];
    }
    return run(file, args, opts);
  };
  const exec = {
    run: aliasedRun,
    start,
    localTransport: () => localTransport(aliasedRun, start),
    sshTransport: () => {
      throw new Error('набір локального вузла: SSH заборонений');
    },
  };
  const realGit = createGit({ exec: { run }, start });
  const git = {
    assertClean: async () => ({ code: /** @type {const} */ (0) }),
    /** @param {string} [sha] */
    resolveCommit: async (sha) => (sha !== undefined && aliases.has(sha) ? { code: /** @type {const} */ (0), sha } : realGit.resolveCommit(sha)),
    /** @param {string} sha */
    archive: (sha) => realGit.archive(sha),
  };

  /** @param {string} file */
  const nodeFile = (file) => path.join(nodeDir, file);

  /**
   * `ops <argv>` у процесі: справжній Docker і локальний транспорт, фейковий Worker.
   * @param {string[]} argv
   */
  async function ops(argv) {
    /** @type {string[]} */
    const lines = [];
    const t0 = Date.now();
    /** @param {string} l */
    const sink = (l) => {
      lines.push(l);
      console.log(`[ops] ${l}`);
    };
    const code = await main(argv, {
      exec,
      git,
      worker: worker.port,
      clock: SYSTEM_CLOCK,
      out: sink,
      err: sink,
      paths: { stateRoot, tunnelEnvFile: () => path.join(stateRoot, 'no-tunnel.env') },
    });
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    console.log(`[p12-timing] ${argv.slice(0, 1).join(' ')} ${argv.includes('--rotate') ? 'rotate ' : ''}→ ${code} in ${seconds}s`);
    return { code, text: lines.join('\n'), lines, seconds };
  }

  /** Записи журналу вузла. */
  const journal = () => {
    const f = nodeFile('journal.jsonl');
    return fs.existsSync(f) ? parseJournal(fs.readFileSync(f, 'utf8')) : [];
  };

  /** Кроки (`<step>:<status>`) запуску з цим комітом, після `from`-го запису. @param {string} sha @param {number} [from] */
  const stepsOf = (sha, from = 0) =>
    journal()
      .slice(from)
      .filter((r) => r.kind === 'step' && r.commit === sha)
      .map((r) => `${/** @type {{ step: string }} */ (r).step}:${/** @type {{ status: string }} */ (r).status}`);

  /** Тривалість кроку (мс) запуску з цим комітом. @param {string} sha @param {string} step @param {number} [from] */
  const stepMs = (sha, step, from = 0) => {
    const r = journal()
      .slice(from)
      .find((x) => x.kind === 'step' && x.commit === sha && /** @type {{ step: string, status: string }} */ (x).step === step && /** @type {{ status: string }} */ (x).status !== 'start');
    return r ? /** @type {{ ms: number }} */ (r).ms : null;
  };

  /** `docker compose -p t2f-node-rehearsal -f <вузол>/compose.yml --env-file <вузол>/current.env <args>`. @param {string[]} args */
  const compose = (args) => docker(['compose', '-p', PROJECT, '-f', nodeFile('compose.yml'), '--env-file', nodeFile('current.env'), ...args]);

  /** Усі контейнери, мережі й томи проєкту набору (за міткою Compose) і допоміжний контейнер зонда. */
  async function removeProject() {
    await docker(['rm', '-f', helper]);
    helperUp = false;
    const ids = (await docker(['ps', '-aq', '--filter', LABEL])).stdout.split(/\s+/).filter(Boolean);
    if (ids.length) await docker(['rm', '-f', ...ids]);
    const nets = (await docker(['network', 'ls', '-q', '--filter', LABEL])).stdout.split(/\s+/).filter(Boolean);
    for (const n of nets) await docker(['network', 'rm', n]);
    const vols = (await docker(['volume', 'ls', '-q', '--filter', LABEL])).stdout.split(/\s+/).filter(Boolean);
    for (const v of vols) await docker(['volume', 'rm', '-f', v]);
  }

  /**
   * Підготовка: залишки проєкту прибрано, `server.env` засіяно заглушками Access/R2, файли змінних —
   * через справжній `edge-secret --generate --target local` (фейковий Worker).
   */
  async function setup() {
    const head = await realGit.resolveCommit();
    if (head.code !== 0) throw new Error('HEAD не коміт');
    base = head.sha;
    baseExisted = (await docker(['image', 'inspect', `t2f-server:${base}`])).code === 0;
    await removeProject();
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.mkdirSync(localDir, { recursive: true });
    let text = fs.readFileSync(path.join(REPO_ROOT, 'infra', 'ops', 'node', 'server.env.example'), 'utf8');
    for (const [k, v] of Object.entries(PLACEHOLDERS)) text = setVar(text, k, v);
    fs.writeFileSync(path.join(localDir, 'server.env'), text, { encoding: 'utf8', mode: 0o600 });
    const g = await ops(['edge-secret', '--env', ENV, '--generate', '--target', 'local']);
    if (g.code !== 0) throw new Error(`edge-secret --generate → ${g.code}\n${g.text}`);
    return base;
  }

  /** Стабільний тег базового образу поза репозиторієм `t2f-server` (прибирання ops його не чіпає). */
  async function pinBase() {
    const r = await docker(['tag', `t2f-server:${base}`, baseAlias]);
    if (r.code !== 0) throw new Error(`docker tag: ${r.stderr}`);
  }

  /**
   * Похідний образ `t2f-server:<sha>` з базового: `ENV T2F_COMMIT=<commit>` і, за потреби, замінені файли.
   * @param {string} sha синтетичний SHA (тег і коміт для ops)
   * @param {{ files?: Record<string, string>, cmd?: string[] }} [o] `files` — шлях у образі → вміст;
   *   `cmd` — інша команда запуску контейнера сервера (одноразові `compose run` її не використовують)
   */
  async function derive(sha, o = {}) {
    if (!SHA40.test(sha)) throw new TypeError('derive: потрібен 40-hex SHA');
    const dir = path.join(stateRoot, `derive-${sha.slice(0, 12)}`);
    fs.mkdirSync(dir, { recursive: true });
    const lines = [`FROM ${baseAlias}`, `ENV T2F_COMMIT=${sha}`];
    Object.entries(o.files ?? {}).forEach(([target, content], i) => {
      fs.writeFileSync(path.join(dir, `f${i}`), content, 'utf8');
      lines.push(`COPY --chown=node:node f${i} ${target}`);
    });
    if (o.cmd) lines.push(`CMD ${JSON.stringify(o.cmd)}`);
    fs.writeFileSync(path.join(dir, 'Dockerfile'), `${lines.join('\n')}\n`, 'utf8');
    const t0 = Date.now();
    const r = await docker(['build', '-q', '-t', `t2f-server:${sha}`, dir]);
    if (r.code !== 0) throw new Error(`docker build (похідний): ${r.stderr.slice(-2000)}`);
    console.log(`[p12-timing] derive ${sha.slice(0, 12)} in ${Math.round((Date.now() - t0) / 1000)}s`);
    aliases.set(sha, base);
    createdTags.add(sha);
    return sha;
  }

  async function ensureHelper() {
    if (helperUp) return;
    await docker(['rm', '-f', helper]);
    const r = await docker(['run', '-d', '--name', helper, '--network', NETWORK, '--entrypoint', 'sleep', baseAlias, 'infinity']);
    if (r.code !== 0) throw new Error(`допоміжний контейнер зонда: ${r.stderr}`);
    helperUp = true;
  }

  /** Поточний `T2F_EDGE_SECRET` файлу вузла (лише для зонда; не друкується). */
  const nodeEdgeSecret = () => getVar(fs.readFileSync(nodeFile('server.env'), 'utf8'), 'T2F_EDGE_SECRET') ?? '';

  /**
   * `health-probe.mjs` з контейнера в мережі `tunnel` проєкту (як `cloudflared`): `http://server:3000<path>`.
   * Секрет — у файлі змінних для `docker exec` (не в argv).
   * @param {{ secret?: 'current' | 'none', value?: string, raw?: boolean, urlPath?: string }} [o]
   */
  async function health(o = {}) {
    await ensureHelper();
    const value = o.value ?? nodeEdgeSecret();
    const envFile = path.join(stateRoot, `probe-${crypto.createHash('sha256').update(value).digest('hex').slice(0, 16)}.env`);
    if (!fs.existsSync(envFile)) fs.writeFileSync(envFile, `T2F_EDGE_SECRET=${value}\n`, { encoding: 'utf8', mode: 0o600 });
    const args = ['exec', '--env-file', envFile, helper, 'node', 'scripts/health-probe.mjs', '--url', `http://server:3000${o.urlPath ?? '/api/health'}`, '--secret', o.secret ?? 'current'];
    if (o.raw) args.push('--raw');
    const r = await docker(args, { timeoutMs: PROBE_TIMEOUT_MS });
    return { code: r.code, stdout: r.stdout.replace(/\r/g, '').trimEnd(), stderr: r.stderr };
  }

  /** Перший рядок відповіді зонда (`<status> <commit>`). */
  const healthLine = async () => (await health()).stdout.split('\n')[0] ?? '';

  /** Чекає, доки здоров’я дасть `200 <sha>`. @param {string} sha @param {number} [timeoutMs] */
  async function waitHealth(sha, timeoutMs = 90_000) {
    const until = Date.now() + timeoutMs;
    let last = '';
    while (Date.now() < until) {
      last = await healthLine();
      if (last === `200 ${sha}`) return last;
      await sleep(1_000);
    }
    return last;
  }

  /** Теги `t2f-server` з 40 hex у локальному Docker. */
  async function serverTags() {
    const r = await docker(['image', 'ls', 't2f-server', '--format', '{{.Tag}}']);
    return [...new Set(r.stdout.split(/\r?\n/).map((l) => l.trim()).filter((l) => SHA40.test(l)))].sort();
  }

  /** Прибирання: проєкт, допоміжний контейнер, теги набору, каталог стану. Ніколи не чіпає проєкт `t2f`. */
  async function cleanup() {
    await removeProject();
    const tags = [...createdTags];
    if (!baseExisted && base) tags.push(base);
    for (const sha of tags) await docker(['image', 'rm', `t2f-server:${sha}`]);
    await docker(['image', 'rm', baseAlias]);
    fs.rmSync(stateRoot, { recursive: true, force: true });
  }

  return {
    stateRoot,
    nodeDir,
    localDir,
    worker,
    get base() {
      return base;
    },
    nodeFile,
    ops,
    journal,
    stepsOf,
    stepMs,
    compose,
    setup,
    pinBase,
    derive,
    health,
    healthLine,
    waitHealth,
    serverTags,
    cleanup,
    /** Значення змінної з файлу вузла (для перевірок; не друкувати). @param {string} file @param {string} key */
    nodeVar: (file, key) => parseEnv(fs.readFileSync(nodeFile(file), 'utf8'))[key],
  };
}
