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
import { createImage } from '../../lib/image.mjs';
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

// --- SPEC-13b W46: копія бази worktree → s3mock → чистий стек `t2f-restore-*` ---

/** Тестове джерело `restore` (приймається лише за `T2F_OPS_TEST=1`). */
export const RESTORE_ENV = 'test-local';
/** s3mock стека worktree (loopback хоста; у контейнери ops веде його переходником через `host.docker.internal`). */
export const S3MOCK_HOST_URL = 'http://127.0.0.1:9090';
/**
 * TCP-переходник усередині контейнера: `node -e "$T2F_FWD" <порт> <хост> <порт> [адреса прослуховування]`.
 * Клас `test` дозволяє копію лише на loopback-кінцеву точку (AC-48), тож s3mock хоста з’являється на 127.0.0.1
 * контейнера; захист сервера не послаблюється. Той самий переходник відкриває сервер класу `test` (слухає лише
 * 127.0.0.1 контейнера) для опитування здоров’я з хоста.
 */
export const FORWARDER_JS =
  "const n=require('net');const [lp,h,p,la]=process.argv.slice(1);n.createServer((c)=>{const u=n.connect(+p,h);c.pipe(u).pipe(c);c.on('error',()=>u.destroy());u.on('error',()=>c.destroy())}).listen(+lp,la||'127.0.0.1')";

/** `server/.env.local` worktree (значення не друкуються). */
export function serverEnvLocal() {
  return /** @type {Record<string, string>} */ (parseEnv(fs.readFileSync(path.join(REPO_ROOT, 'server', '.env.local'), 'utf8')));
}

/** Текст файлу змінних для `docker --env-file`; значення з переводом рядка — помилка. @param {Record<string, string>} vars */
export function envFileText(vars) {
  return `${Object.entries(vars)
    .map(([k, v]) => {
      if (/[\r\n]/.test(v)) throw new Error(`env-file: значення ${k} має перевід рядка`);
      return `${k}=${v}`;
    })
    .join('\n')}\n`;
}

/** Порт loopback-URL змінної `.env.local` (база, Redis). @param {string | undefined} v @param {string} fallback */
const portOf = (v, fallback) => {
  try {
    return new URL(String(v)).port || fallback;
  } catch {
    return fallback;
  }
};

/**
 * Обв’язка `restore.int.test.mjs`: каталог стану `infra/ops/.local/node-suite-restore-<pid>/` (git-ignored) з
 * `test-local/server.env` (s3mock, бакет `t2f-catalog`, префікс `T2F_R2_PREFIX` worktree, ключ копії цього
 * запуску), образ HEAD, копія бази worktree образом HEAD (`ops backup-now` у разовому контейнері), `ops restore`
 * у процесі (справжній Docker, SSH заборонений), підміна об’єктів s3mock.
 */
export function createRestoreSuite() {
  const stateRoot = path.join(REPO_ROOT, 'infra', 'ops', '.local', `node-suite-restore-${process.pid}`);
  const envDir = path.join(stateRoot, RESTORE_ENV);
  const local = serverEnvLocal();
  const bucket = local.T2F_R2_BUCKET ?? 't2f-catalog';
  // Префікс середовища worktree (схема: один сегмент); набір видаляє лише ключі, створені ним, під `<prefix>backups/db/`.
  const prefix = local.T2F_R2_PREFIX ?? 'spec_13b_ops/';
  const backupsPrefix = `${prefix}backups/db/`;
  /** Ключі, що були до запуску (чужі — не видаляються). @type {Set<string>} */
  let before = new Set();
  /** Ключ копії цього запуску: лише в пам’яті й у git-ignored файлі стану. */
  const backupKey = crypto.randomBytes(32).toString('base64');
  let head = '';
  let headExisted = true;
  const realGit = createGit({ exec: { run }, start });
  const exec = {
    run,
    start,
    localTransport: () => localTransport(run, start),
    sshTransport: () => {
      throw new Error('набір відновлення: SSH заборонений');
    },
  };

  /** `server.env` джерела `test-local`. @param {Record<string, string>} [over] */
  function writeSourceEnv(over = {}) {
    const vars = {
      T2F_R2_ENDPOINT: S3MOCK_HOST_URL,
      T2F_R2_BUCKET: bucket,
      T2F_R2_ACCESS_KEY_ID: local.T2F_R2_ACCESS_KEY_ID ?? 'local',
      T2F_R2_SECRET_ACCESS_KEY: local.T2F_R2_SECRET_ACCESS_KEY ?? 'local',
      T2F_R2_PREFIX: prefix,
      T2F_BACKUP_KEY: backupKey,
      ...over,
    };
    fs.mkdirSync(envDir, { recursive: true });
    fs.writeFileSync(path.join(envDir, 'server.env'), envFileText(vars), { encoding: 'utf8', mode: 0o600 });
  }

  /** URL об’єкта s3mock з хоста (path-style). @param {string} key */
  const objectUrl = (key) => `${S3MOCK_HOST_URL}/${bucket}/${key.split('/').map(encodeURIComponent).join('/')}`;

  /** @param {string} key */
  async function getObject(key) {
    const r = await fetch(objectUrl(key));
    if (r.status !== 200) throw new Error(`s3mock GET ${r.status}`);
    return Buffer.from(await r.arrayBuffer());
  }

  /** @param {string} key @param {Buffer} body */
  async function putObject(key, body) {
    const r = await fetch(objectUrl(key), { method: 'PUT', body: new Uint8Array(body), headers: { 'content-type': 'application/octet-stream' } });
    if (r.status !== 200) throw new Error(`s3mock PUT ${r.status}`);
  }

  /** Усі ключі під префіксом набору (ListObjectsV2, XML). */
  async function listKeys() {
    const r = await fetch(`${S3MOCK_HOST_URL}/${bucket}?list-type=2&prefix=${encodeURIComponent(backupsPrefix)}`);
    const xml = await r.text();
    return [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map((m) => m[1]);
  }

  /** Видаляє лише ключі, створені цим запуском. */
  async function deleteOwn() {
    for (const k of await listKeys()) if (!before.has(k)) await fetch(objectUrl(k), { method: 'DELETE' });
  }

  /** Образ HEAD (той самий, що збирає `ops restore` як образ-читач). */
  async function ensureHeadImage() {
    const h = await realGit.resolveCommit();
    if (h.code !== 0) throw new Error('HEAD не коміт');
    head = h.sha;
    headExisted = (await docker(['image', 'inspect', `t2f-server:${head}`])).code === 0;
    const t0 = Date.now();
    const b = await createImage({ local: localTransport(run, start), git: realGit, start }).buildImage(head);
    if (b.code !== 0) throw new Error(`образ HEAD не зібрано: ${'message' in b ? b.message : ''}`);
    console.log(`[w46] image t2f-server:${head.slice(0, 12)} ${headExisted ? 'present' : `built in ${Math.round((Date.now() - t0) / 1000)}s`}`);
    return head;
  }

  /**
   * Копія бази worktree (`DATABASE_URI` з `server/.env.local`) образом HEAD: `pnpm run ops backup-now` у разовому
   * контейнері, клас `test`, s3mock через переходник на 127.0.0.1:9090 контейнера. Повертає маніфест.
   */
  async function backup() {
    /** @type {Record<string, string>} */
    const vars = {};
    // Клас `test` приймає лише loopback-базу й Redis (ізоляція worktree): URL лишаються як у `.env.local`, а
    // переходники в контейнері ведуть 127.0.0.1:<порт> до тих самих портів хоста.
    for (const [k, v] of Object.entries(local)) vars[k] = String(v);
    const pgPort = portOf(local.DATABASE_URI, '5433');
    const redisPort = portOf(local.REDIS_URL, '6380');
    Object.assign(vars, {
      T2F_ENV: 'test',
      T2F_R2_ENDPOINT: S3MOCK_HOST_URL,
      T2F_R2_PREFIX: prefix,
      T2F_BACKUP_KEY: backupKey,
      T2F_FWD: FORWARDER_JS,
    });
    const file = path.join(stateRoot, 'backup.env');
    fs.writeFileSync(file, envFileText(vars), { encoding: 'utf8', mode: 0o600 });
    const t0 = Date.now();
    const r = await docker([
      'run', '--rm', '--env-file', file, '--entrypoint', 'sh', `t2f-server:${head}`, '-c',
      `${[pgPort, redisPort, '9090'].map((p) => `node -e "$T2F_FWD" ${p} host.docker.internal ${p} 127.0.0.1 & `).join('')}sleep 1; pnpm run ops backup-now`,
    ]);
    fs.rmSync(file, { force: true });
    const line = r.stdout.split(/\r?\n/).filter((l) => l.startsWith('{')).at(-1) ?? '';
    /** @type {any} */
    let answer = null;
    try {
      answer = JSON.parse(line);
    } catch {
      /* нижче */
    }
    if (r.code !== 0 || answer?.ok !== true) throw new Error(`backup-now → ${r.code}: ${r.stderr.split(/\r?\n/).slice(-5).join(' | ')}`);
    const seconds = Math.round((Date.now() - t0) / 100) / 10;
    console.log(`[w46] backup-now ${seconds}s (incl. container start), dump ${answer.manifest.size} bytes, key ${answer.key}`);
    return /** @type {{ key: string, manifest: Record<string, any>, seconds: number }} */ ({ key: answer.key, manifest: answer.manifest, seconds });
  }

  /**
   * SQL у базі worktree (`DATABASE_URI` з `.env.local`) через `psql` контейнера `postgres` спільного стека; пароль —
   * лише середовищем процесу (`-e PGPASSWORD`), не argv.
   * @param {string} statement
   */
  async function sql(statement) {
    const u = new URL(String(local.DATABASE_URI));
    const r = await docker(
      ['exec', '-e', 'PGPASSWORD', 't2f-postgres-1', 'psql', '-h', '127.0.0.1', '-U', decodeURIComponent(u.username), '-d', decodeURIComponent(u.pathname.slice(1)), '-v', 'ON_ERROR_STOP=1', '-tAc', statement],
      { env: { ...process.env, PGPASSWORD: decodeURIComponent(u.password) } },
    );
    if (r.code !== 0) throw new Error(`psql → ${r.code}`);
    return r.stdout.trim();
  }

  /** `ops <argv>` у процесі (справжній Docker; SSH заборонений). @param {string[]} argv */
  async function ops(argv) {
    /** @type {string[]} */
    const lines = [];
    const t0 = Date.now();
    /** @param {string} l */
    const sink = (l) => {
      lines.push(l);
      console.log(`[ops] ${l}`);
    };
    const code = await main(argv, { exec, git: realGit, clock: SYSTEM_CLOCK, out: sink, err: sink, paths: { stateRoot } });
    return { code, text: lines.join('\n'), lines, seconds: Math.round((Date.now() - t0) / 100) / 10 };
  }

  /** Залишки запусків: теки `restore/<проєкт>` і проєкти Compose `t2f-restore-*` (контейнери, томи). */
  async function leftovers() {
    const dir = path.join(stateRoot, 'restore');
    const dirs = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
    const ps = await docker(['ps', '-a', '--format', '{{.Label "com.docker.compose.project"}}']);
    const vols = await docker(['volume', 'ls', '--format', '{{.Label "com.docker.compose.project"}}']);
    const projects = [...ps.stdout.split(/\r?\n/), ...vols.stdout.split(/\r?\n/)].map((l) => l.trim()).filter((p) => p.startsWith('t2f-restore-'));
    return { dirs, projects: [...new Set(projects)] };
  }

  async function setup() {
    fs.rmSync(stateRoot, { recursive: true, force: true });
    fs.mkdirSync(stateRoot, { recursive: true });
    writeSourceEnv();
    before = new Set(await listKeys());
    await ensureHeadImage();
  }

  /** Прибирання: об’єкти префікса, каталог стану; образ HEAD — лише якщо його створив цей запуск. */
  async function cleanup() {
    await deleteOwn().catch(() => undefined);
    fs.rmSync(stateRoot, { recursive: true, force: true });
    if (!headExisted && head && process.env.T2F_W46_KEEP_IMAGE !== '1') await docker(['image', 'rm', `t2f-server:${head}`]);
  }

  return {
    stateRoot,
    prefix,
    get head() {
      return head;
    },
    writeSourceEnv,
    getObject,
    putObject,
    listKeys,
    backup,
    sql,
    ops,
    leftovers,
    setup,
    cleanup,
  };
}
