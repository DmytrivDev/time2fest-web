// @ts-check
// Секрети репетиції (AC-37, AC-38, NFR-4): генерація файлів змінних вузла й заміна секрету краю.
// Значення — лише `randomBytes(32)`; живуть тільки в git-ignored `infra/ops/.local/<env>/` (0600), у файлах
// вузла (0600, `umask 077`) і в секреті Worker’а. Передаються лише через stdin — ніколи в argv, вивід чи журнал.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { ENVS } from './config.mjs';
import { createStepper, DEFAULT_STATE_ROOT, messageOf, resolveSite } from './deploy.mjs';
import { REPO_ROOT } from './exec.mjs';
import { currentGeneration } from './journal.mjs';
import { acquireNodeLock } from './lock.mjs';
import { createNode, CURRENT_ENV, SYSTEM_CLOCK } from './node.mjs';
import { startProbe as realStartProbe } from './probe.mjs';
import { createWorker } from './worker.mjs';

/** Файли змінних вузла (W11): поруч із `compose.yml` на вузлі, оригінали — у `.local/<env>/`. */
export const NODE_ENV_FILES = /** @type {const} */ (['server.env', 'postgres.env', 'cloudflared.env']);
/** Приклади з самими назвами (W11), з яких створюються локальні файли. */
export const EXAMPLES_DIR = path.join(REPO_ROOT, 'infra', 'ops', 'node');
/** Віддалений запис файлу змінних: права 0600 від початку, атомарна заміна. Шлях — `$1`, вміст — stdin. */
export const PUSH_SCRIPT = 'umask 077 && cat > "$1.tmp" && mv "$1.tmp" "$1"';
/** Позначка «новий секрет краю ще не в Worker’і» (без значення): повторний запуск дошле його. */
export const WORKER_PENDING = 'edge-secret.worker-pending';
export const SECRET_BYTES = 32;
const EDGE_CHECK_ATTEMPTS = 10;
const EDGE_CHECK_EVERY_MS = 3_000;
const EDGE_CHECK_TIMEOUT_MS = 5_000;
const PUSH_TIMEOUT_MS = 30_000;
const PROBE_CALL_TIMEOUT_MS = 10_000;

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {{
 *   examplesDir?: string,
 *   tunnelEnvFile?: string,
 *   platform?: NodeJS.Platform,
 *   edgeCheck?: (url: string) => Promise<boolean>,
 * }} SecretsDeps `examplesDir` — інший каталог прикладів; `tunnelEnvFile` — інший файл токена тунелю;
 *   `platform` — для перевірки гілки Windows; `edgeCheck` — одна перевірка `GET <url>` → 200 (тести)
 * @typedef {'server.env' | 'postgres.env' | 'cloudflared.env'} EnvFileName
 */

/** Новий секрет: 32 байти CSPRNG у base64url (43 символи). */
export function newSecret() {
  return crypto.randomBytes(SECRET_BYTES).toString('base64url');
}

/** @param {string} name */
const lineRe = (name) => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=(.*)$`);

/**
 * Значення змінної з тексту env-файлу; немає рядка — `undefined`, порожнє — `''`. Лапки навколо знімаються.
 * @param {string} text
 * @param {string} name
 */
export function getVar(text, name) {
  const re = lineRe(name);
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(re);
    if (!m) continue;
    const v = m[1].trim();
    return /^(["']).*\1$/.test(v) && v.length >= 2 ? v.slice(1, -1) : v;
  }
  return undefined;
}

/**
 * Ставить `NAME=value` замість першого рядка змінної або дописує в кінець.
 * @param {string} text
 * @param {string} name
 * @param {string} value
 */
export function setVar(text, name, value) {
  if (/[\r\n]/.test(value)) throw new TypeError(`${name}: значення з переводом рядка`);
  const re = lineRe(name);
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const i = lines.findIndex((l) => re.test(l));
  if (i >= 0) lines[i] = `${name}=${value}`;
  else lines.push(`${name}=${value}`);
  return `${lines.join('\n')}\n`;
}

/**
 * Прибирає всі рядки змінної.
 * @param {string} text
 * @param {string} name
 */
export function removeVar(text, name) {
  const re = lineRe(name);
  const lines = String(text).split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  const kept = lines.filter((l) => !re.test(l));
  return kept.length ? `${kept.join('\n')}\n` : '';
}

/**
 * `DATABASE_URI` для контейнера сервера: збирається через `URL`, без рядкового літерала з паролем.
 * @param {{ user: string, password: string, db: string }} o
 */
export function databaseUri(o) {
  const u = new URL('postgres://postgres:5432/t2f_rehearsal');
  u.pathname = `/${o.db}`;
  u.username = o.user;
  u.password = o.password;
  return u.toString();
}

/** Каталог локальних оригіналів середовища. @param {OpsContext} ctx @param {string} env */
export function localEnvDir(ctx, env) {
  return path.join(ctx.deps?.stateRoot ?? DEFAULT_STATE_ROOT, env);
}

/**
 * Файл лише для власника. Windows: права не діють — замість них шлях має бути git-ignored (`git check-ignore -q`).
 * Відмова — виняток із `code: 2` до запису.
 * @param {OpsContext} ctx
 * @param {string} file
 */
async function assertPrivatePath(ctx, file) {
  const platform = ctx.deps?.platform ?? process.platform;
  if (platform !== 'win32') return;
  const r = await ctx.exec.run('git', ['check-ignore', '-q', file], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: PUSH_TIMEOUT_MS,
  });
  if (r.code !== 0) throw Object.assign(new Error(`${path.basename(file)}: шлях не git-ignored — секрети туди не пишуться`), { code: 2 });
}

/**
 * Атомарний локальний запис з режимом 0600.
 * @param {string} file
 * @param {string} text
 */
function writePrivate(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, { encoding: 'utf8', mode: 0o600 });
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
  fs.chmodSync(file, 0o600);
}

/**
 * Надсилає файл змінних на ціль: вузол — `sh -c PUSH_SCRIPT` зі вмістом на stdin; локальна ціль — копія 0600.
 * @param {Transport} transport
 * @param {string} nodeDir
 * @param {string} name
 * @param {string} text
 */
async function pushFile(transport, nodeDir, name, text) {
  if (transport.kind === 'local') {
    writePrivate(path.join(nodeDir, name), text);
    return;
  }
  const argv = ['sh', '-c', PUSH_SCRIPT, '_', path.posix.join(nodeDir, name)];
  const r = await transport.exec(argv, { input: text, allow: [...argv], timeoutMs: PUSH_TIMEOUT_MS });
  if (r.code !== 0) throw new Error(`надсилання ${name} завершилося з кодом ${r.code}`);
}

/** @param {OpsContext} ctx */
function workerOf(ctx) {
  const env = /** @type {string} */ (ctx.args.env);
  return ctx.deps?.worker ?? createWorker({ env, processEnv: ctx.env, run: ctx.exec.run, out: ctx.out });
}

/**
 * `ops edge-secret --env rehearsal --generate|--rotate`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runEdgeSecret(ctx) {
  try {
    if (ctx.args.env !== 'rehearsal') {
      ctx.err('edge-secret: лише --env rehearsal');
      return 2;
    }
    return ctx.args.flags.rotate === true ? await rotate(ctx) : await generate(ctx);
  } catch (e) {
    const code = /** @type {{ code?: unknown }} */ (e).code === 2 ? 2 : 1;
    ctx.err(`edge-secret: ${messageOf(e)}`);
    return code;
  }
}

/**
 * W22: заповнює порожні значення файлів `.local/<env>/`, за `--target` надсилає всі три файли, новий секрет
 * краю — у Worker. Наявні значення ніколи не генеруються заново.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function generate(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const deps = ctx.deps ?? {};
  const dir = localEnvDir(ctx, env);
  const examplesDir = deps.examplesDir ?? EXAMPLES_DIR;
  /** @param {string} m */
  const refuse = (m) => {
    err(`edge-secret: ${m}`);
    return 2;
  };

  // 1. Без змін: шляхи приватні, приклади є, поточний стан.
  /** @type {Record<string, string>} */
  const text = {};
  /** @type {Record<string, boolean>} */
  const created = {};
  for (const name of NODE_ENV_FILES) {
    const file = path.join(dir, name);
    await assertPrivatePath(ctx, file);
    if (fs.existsSync(file)) {
      text[name] = fs.readFileSync(file, 'utf8');
      created[name] = false;
    } else {
      const example = path.join(examplesDir, `${name}.example`);
      if (!fs.existsSync(example)) return refuse(`немає прикладу infra/ops/node/${name}.example`);
      text[name] = fs.readFileSync(example, 'utf8');
      created[name] = true;
    }
  }
  // Наявні значення — одразу в редактор: жодне не може потрапити у вивід.
  for (const name of NODE_ENV_FILES) {
    for (const line of text[name].split(/\r?\n/)) {
      const m = line.match(/^\s*(?:export\s+)?[A-Za-z_][A-Za-z0-9_]*\s*=(.*)$/);
      if (m) ctx.redactor.add(m[1].trim());
    }
  }

  const pg = text['postgres.env'];
  const srv = text['server.env'];
  if (!getVar(pg, 'POSTGRES_PASSWORD') && getVar(srv, 'DATABASE_URI')) {
    return refuse('DATABASE_URI заповнено, а POSTGRES_PASSWORD — ні; виправте файли в .local вручну');
  }
  const pendingFile = path.join(dir, WORKER_PENDING);
  const edgeNew = !getVar(srv, 'T2F_EDGE_SECRET');
  const workerNeeded = edgeNew || fs.existsSync(pendingFile);
  const worker = workerNeeded ? workerOf(ctx) : undefined;
  if (worker) {
    const missing = worker.missingCredentials();
    if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);
  }

  /** @type {Awaited<ReturnType<typeof acquireNodeLock>> | undefined} */
  let lock;
  /** @type {import('./deploy.mjs').Site | undefined} */
  let site;
  if (ctx.args.values.target !== undefined) {
    const resolved = resolveSite(ctx);
    if (resolved.code !== 0) return refuse(resolved.message);
    site = resolved.site;
    if (site.transport.kind === 'local') {
      for (const name of NODE_ENV_FILES) await assertPrivatePath(ctx, path.join(/** @type {string} */ (site.nodeDir), name));
    }
    lock = await acquireNodeLock(site.transport, env, site.lockOpts);
    if (lock.code !== 0) return refuse(lock.message);
  }

  try {
    // 2. Заповнення порожніх значень.
    /** @type {string[]} */
    const report = [];
    /**
     * @param {EnvFileName} file
     * @param {string} name
     * @param {() => string | undefined} make
     * @param {string} [madeWord]
     */
    const fill = (file, name, make, madeWord = 'згенеровано') => {
      if (getVar(text[file], name)) {
        report.push(`${file} ${name} — вже було`);
        return false;
      }
      const v = make();
      if (v === undefined) {
        report.push(`${file} ${name} — порожньо`);
        return false;
      }
      ctx.redactor.add(v);
      text[file] = setVar(text[file], name, v);
      report.push(`${file} ${name} — ${madeWord}`);
      return true;
    };

    fill('postgres.env', 'POSTGRES_USER', () => 't2f', 'задано');
    fill('postgres.env', 'POSTGRES_DB', () => `t2f_${env}`, 'задано');
    fill('postgres.env', 'POSTGRES_PASSWORD', newSecret);
    fill('server.env', 'PAYLOAD_SECRET', newSecret);
    fill('server.env', 'T2F_EDGE_SECRET', newSecret);
    fill('server.env', 'DATABASE_URI', () =>
      databaseUri({
        user: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_USER')),
        password: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_PASSWORD')),
        db: /** @type {string} */ (getVar(text['postgres.env'], 'POSTGRES_DB')),
      }),
    );
    fill('server.env', 'REDIS_URL', () => 'redis://redis:6379/0', 'задано');
    fill('server.env', 'T2F_REDIS_PREFIX', () => `t2f:${env}:`, 'задано');
    const tunnelFile = deps.tunnelEnvFile ?? path.join(REPO_ROOT, 'infra', 'cloudflare', '.local', `tunnel-${env}.env`);
    fill('cloudflared.env', 'TUNNEL_TOKEN', () => {
      if (!fs.existsSync(tunnelFile)) return undefined;
      const v = getVar(fs.readFileSync(tunnelFile, 'utf8'), 'TUNNEL_TOKEN');
      return v || undefined;
    }, 'скопійовано з infra/cloudflare/.local');

    // Новий секрет краю: позначка «ще не в Worker’і» — до запису файлу, щоб збій не загубив його.
    if (edgeNew) writePrivate(pendingFile, '');
    for (const name of NODE_ENV_FILES) writePrivate(path.join(dir, name), text[name]);
    for (const name of NODE_ENV_FILES) if (created[name]) out(`edge-secret: ${name} створено з прикладу`);
    for (const line of report) out(`edge-secret: ${line}`);

    // 3. Надсилання на ціль.
    if (site) {
      for (const name of NODE_ENV_FILES) {
        await pushFile(site.transport, /** @type {string} */ (site.nodeDir), name, text[name]);
        out(`edge-secret: ${name} — надіслано (${site.transport.describe})`);
      }
      out('edge-secret: сервер підхопить змінені значення після наступного перезапуску (deploy)');
    }

    // 4. Секрет краю — у Worker (stdin).
    if (worker) {
      const v = /** @type {string} */ (getVar(text['server.env'], 'T2F_EDGE_SECRET'));
      const r = await worker.putSecret('T2F_EDGE_SECRET', v);
      if (r.code !== 0) {
        err(`edge-secret: ${r.message}; повторіть --generate, щоб дослати`);
        return 1;
      }
      fs.rmSync(pendingFile, { force: true });
      out('edge-secret: T2F_EDGE_SECRET — надіслано у Worker');
    }
    return 0;
  } finally {
    if (lock && lock.code === 0) await lock.release();
  }
}

/**
 * Одна перевірка `GET <url>` → 200 (без облікових даних, без переходів).
 * @param {string} url
 */
async function fetchOk(url) {
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(EDGE_CHECK_TIMEOUT_MS) });
    await res.body?.cancel().catch(() => {});
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * W23: заміна секрету краю під замком вузла. (1) сервер: новий + старий як PREVIOUS, перезапуск, здоров’я;
 * (2) новий — у Worker; (3) перевірка через край; (4) без PREVIOUS, перезапуск, здоров’я; (5) покоління +1.
 * Невдача (3) зупиняє все: PREVIOUS лишається, обидва значення працюють.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function rotate(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const cfg = ENVS[env];
  const deps = ctx.deps ?? {};
  /** @param {string} m */
  const refuse = (m) => {
    err(`edge-secret: ${m}`);
    return 2;
  };

  if (ctx.args.values.target === undefined) return refuse('--target: обов’язковий для --rotate (local або адреса вузла)');
  const localFile = path.join(localEnvDir(ctx, env), 'server.env');
  await assertPrivatePath(ctx, localFile);
  if (!fs.existsSync(localFile)) return refuse('немає .local server.env — спершу --generate');
  let text = fs.readFileSync(localFile, 'utf8');
  const old = getVar(text, 'T2F_EDGE_SECRET');
  if (!old) return refuse('у .local server.env порожній T2F_EDGE_SECRET — спершу --generate');
  ctx.redactor.add(old);
  const prevLeft = getVar(text, 'T2F_EDGE_SECRET_PREVIOUS');
  if (prevLeft) ctx.redactor.add(prevLeft);

  const worker = workerOf(ctx);
  const missing = worker.missingCredentials();
  if (missing.length) return refuse(`бракує змінних: ${missing.join(', ')} (середовище або --secrets-file)`);

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  const nodeDir = /** @type {string} */ (site.nodeDir);
  if (site.transport.kind === 'local') await assertPrivatePath(ctx, path.join(nodeDir, 'server.env'));

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  try {
    const clock = deps.clock ?? SYSTEM_CLOCK;
    const node = createNode({ transport: site.transport, env, project: /** @type {string} */ (site.project), nodeDir, clock });
    const records = await site.journal.read();
    const generation = currentGeneration(records, env);
    const running = await node.readCurrent();
    if (!running) return refuse('на вузлі немає працюючого сервера (current.env) — спершу deploy');

    const fresh = newSecret();
    ctx.redactor.add(fresh);
    const step = createStepper({ journal: site.journal, env, commit: running, clock, now: ctx.now });

    /**
     * Спершу вузол, потім локальний оригінал: невдале надсилання лишає `.local` таким, як на вузлі, і повторний
     * запуск бере за «старий» секрет те значення, яке Worker справді має.
     * @param {string} next
     */
    const pushServerEnv = async (next) => {
      await pushFile(site.transport, nodeDir, 'server.env', next);
      writePrivate(localFile, next);
      text = next;
    };
    const restart = async () => {
      const s = await node.swap(CURRENT_ENV);
      return s.code === 0 ? node.waitHealthy(CURRENT_ENV, running) : s;
    };

    const localCheck = async () => {
      const argv = node.argv(CURRENT_ENV, ['exec', '-T', 'server', 'node', 'scripts/health-probe.mjs', '--secret', 'current']);
      return (await site.transport.exec(argv, { timeoutMs: PROBE_CALL_TIMEOUT_MS })).code === 0;
    };
    const startProbe = deps.startProbe ?? realStartProbe;
    const probe =
      ctx.args.flags.probe !== true
        ? undefined
        : site.transport.kind === 'local'
          ? startProbe({ check: localCheck })
          : cfg.siteHost
            ? startProbe({ url: `https://${cfg.siteHost}/api/health` })
            : undefined;
    const stopProbe = () => {
      const r = probe?.stop();
      if (r) out(`edge-secret: простій ${r.downtimeSeconds} с (проб ${r.samples}, невдалих ${r.failures})`);
    };

    let workerHasNew = false;
    const bumpGeneration = () => site.journal.append({ kind: 'edge-secret', at: ctx.now().toISOString(), env, generation: generation + 1 });
    /** @param {string} what @param {{ code: number, message?: string }} r */
    const fail = async (what, r) => {
      err(`edge-secret: ${what}: ${r.message ?? `код ${r.code}`}`);
      stopProbe();
      // Worker уже з новим секретом: покоління змінилося, навіть якщо далі не вдалося (відкат Worker’а повернув би старий).
      if (workerHasNew) await bumpGeneration();
      return 1;
    };

    out(`edge-secret: ${env} — заміна секрету краю (${site.transport.describe})`);
    // (1) Сервер приймає обидва.
    const both = await step('edge-secret:server', async () => {
      await pushServerEnv(setVar(setVar(text, 'T2F_EDGE_SECRET_PREVIOUS', old), 'T2F_EDGE_SECRET', fresh));
      return restart();
    });
    if (both.code !== 0) return await fail('сервер з новим і старим секретом не став здоровим', both);
    out('edge-secret: 1/4 сервер приймає новий і старий секрет');

    // (2) Worker — новий.
    const put = await step('edge-secret:worker', () => worker.putSecret('T2F_EDGE_SECRET', fresh));
    if (put.code !== 0) return await fail('секрет Worker’а не записано', put);
    workerHasNew = true;
    out('edge-secret: 2/4 Worker з новим секретом');

    // (3) Перевірка через край.
    const checked = await step('edge-secret:check', async () => {
      if (site.transport.kind === 'local') {
        return (await localCheck()) ? { code: /** @type {const} */ (0) } : { code: /** @type {const} */ (1), message: 'health-probe з поточним секретом не дав 200' };
      }
      if (!cfg.siteHost) return { code: /** @type {const} */ (1), message: 'у середовища немає імені сайту' };
      const url = `https://${cfg.siteHost}/api/health`;
      const check = deps.edgeCheck ?? fetchOk;
      for (let i = 0; i < EDGE_CHECK_ATTEMPTS; i++) {
        if (await check(url)) return { code: /** @type {const} */ (0) };
        if (i < EDGE_CHECK_ATTEMPTS - 1) await clock.sleep(EDGE_CHECK_EVERY_MS);
      }
      return { code: /** @type {const} */ (1), message: `GET ${url} не дав 200 за ${EDGE_CHECK_ATTEMPTS} спроб` };
    });
    if (checked.code !== 0) {
      err('edge-secret: T2F_EDGE_SECRET_PREVIOUS лишився на сервері — обидва значення приймаються; з’ясуйте причину й повторіть --rotate');
      return await fail('перевірка через край не пройшла', checked);
    }
    out('edge-secret: 3/4 край відповідає 200');

    // (4) Без PREVIOUS.
    const dropped = await step('edge-secret:drop-previous', async () => {
      await pushServerEnv(removeVar(text, 'T2F_EDGE_SECRET_PREVIOUS'));
      return restart();
    });
    if (dropped.code !== 0) return await fail('сервер без старого секрету не став здоровим', dropped);
    out('edge-secret: 4/4 старий секрет прибрано');

    // (5) Покоління.
    await bumpGeneration();
    stopProbe();
    out(`edge-secret: готово; покоління секрету краю ${generation + 1}`);
    return 0;
  } finally {
    await lock.release();
  }
}
