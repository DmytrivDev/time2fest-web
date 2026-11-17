// @ts-check
// Вузол (AC-9, AC-12, AC-13, AC-18): вільне місце, `compose.yml` з дерева коміту, файли інтерполяції Compose,
// міграції одноразовим контейнером, заміна контейнера сервера, очікування здоров’я, тунель.
// Ніколи `docker compose down` і нічого з томами (A02). Файли змінних вузла (`server.env`, `postgres.env`,
// `redis.env`, `cloudflared.env`) тут лише читаються на наявність `TUNNEL_TOKEN` — ніколи не пишуться (AC-25).
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT, SHA40 } from './exec.mjs';

/** Шлях Compose-файлу вузла в дереві коміту (W10). */
export const COMPOSE_PATH = 'infra/ops/node/compose.yml';
export const COMPOSE_FILE = 'compose.yml';
/** Файл інтерполяції Compose поточного образу: лише `T2F_ENV` і `T2F_SERVER_SHA` (A3). */
export const CURRENT_ENV = 'current.env';
/** Той самий формат для образу, що лише розгортається (міграції, заміна, перевірка здоров’я). */
export const NEXT_ENV = 'next.env';
export const TUNNEL_ENV = 'cloudflared.env';
/** Менше — відмова до доставки образу (AC-18). */
export const MIN_FREE_BYTES = 5 * 1024 ** 3;
export const HEALTH_TIMEOUT_MS = 60_000;
export const HEALTH_EVERY_MS = 1_000;

const MIGRATE_TIMEOUT_MS = 15 * 60_000;
const COMPOSE_TIMEOUT_MS = 5 * 60_000;
const PROBE_CALL_TIMEOUT_MS = 10_000;
const READ_TIMEOUT_MS = 30_000;
const RE_REMOTE_DIR = /^\/[A-Za-z0-9_./-]+$/;
const RE_PROJECT = /^[a-z0-9][a-z0-9_-]{0,62}$/;
const RE_PINNED = /^[a-z0-9][a-z0-9./_-]*(?::[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
const WRITE_SCRIPT = 'cat > "$1.tmp" && mv "$1.tmp" "$1"';
const READ_SCRIPT = 'test ! -e "$1" || cat -- "$1"';
const TUNNEL_TOKEN_RE = '^TUNNEL_TOKEN=.';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./exec.mjs').RunResult} RunResult
 * @typedef {{ now: () => number, sleep: (ms: number) => Promise<void> }} Clock мілісекунди; у тестах — підставний
 * @typedef {{ code: 0 } | { code: 1, message: string, detail?: string }} StepResult
 */

/** @type {Clock} */
export const SYSTEM_CLOCK = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
};

/**
 * Argv одного виклику Compose вузла. `envFile` — файл інтерполяції (`current.env` або `next.env`).
 * @param {{ project: string, nodeDir: string, local: boolean }} where
 * @param {string} envFile
 * @param {string[]} args
 */
export function composeArgv(where, envFile, args) {
  const join = where.local ? path.join : path.posix.join;
  return [
    'docker', 'compose',
    '-p', where.project,
    '-f', join(where.nodeDir, COMPOSE_FILE),
    '--env-file', join(where.nodeDir, envFile),
    ...args,
  ];
}

/**
 * Образ сервісу з тексту Compose-файлу (без бібліотеки YAML): рядок `image:` у блоці `  <service>:`.
 * @param {string} text
 * @param {string} service
 * @returns {string | null}
 */
export function serviceImage(text, service) {
  const lines = String(text).split(/\r?\n/);
  let inside = false;
  for (const line of lines) {
    if (/^ {2}\S/.test(line)) {
      inside = line.trim() === `${service}:`;
      continue;
    }
    if (/^\S/.test(line)) inside = false;
    const m = inside ? line.match(/^ {4}image:\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/) : null;
    if (m) return m[1];
  }
  return null;
}

/**
 * Вільні байти з виводу `df -Pk`: останній рядок, четверта колонка (Available, блоки 1024).
 * @param {string} stdout
 * @returns {number | null}
 */
export function parseDfAvailable(stdout) {
  const lines = String(stdout).split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length < 2) return null;
  const cols = lines[lines.length - 1].trim().split(/\s+/);
  const kb = Number(cols[3]);
  return Number.isSafeInteger(kb) && kb >= 0 ? kb * 1024 : null;
}

/**
 * `T2F_SERVER_SHA` із файлу інтерполяції; відсутній чи зіпсований — `null`.
 * @param {string} text
 */
export function parseCurrentSha(text) {
  const m = String(text).match(/^T2F_SERVER_SHA=([0-9a-f]{40})\s*$/m);
  return m ? m[1] : null;
}

/**
 * Compose-файл вузла з дерева коміту (`git show <sha>:infra/ops/node/compose.yml`).
 * @param {(file: string, args: string[], opts?: import('./exec.mjs').RunOpts) => Promise<RunResult>} run
 * @param {string} sha
 * @returns {Promise<{ code: 0, text: string } | { code: 2, message: string }>}
 */
export async function composeAt(run, sha) {
  if (!SHA40.test(sha)) return { code: 2, message: 'compose: потрібен повний SHA коміту' };
  const r = await run('git', ['show', `${sha}:${COMPOSE_PATH}`], {
    cwd: REPO_ROOT,
    env: { ...process.env, GIT_PAGER: 'cat', GIT_TERMINAL_PROMPT: '0' },
    timeoutMs: READ_TIMEOUT_MS,
  });
  if (r.code !== 0 || r.stdout.trim() === '') return { code: 2, message: `у коміті немає ${COMPOSE_PATH}` };
  return { code: 0, text: r.stdout };
}

/**
 * @param {{
 *   transport: Transport,
 *   env: string,
 *   project: string,
 *   nodeDir: string,
 *   clock?: Clock,
 * }} o `nodeDir` — абсолютний POSIX-шлях на вузлі або локальний каталог стану (для транспорту `local`)
 */
export function createNode(o) {
  const t = o.transport;
  const local = t.kind === 'local';
  const clock = o.clock ?? SYSTEM_CLOCK;
  if (!RE_PROJECT.test(o.project)) throw new TypeError('вузол: недопустима назва проєкту Compose');
  if (local ? !path.isAbsolute(o.nodeDir) : !RE_REMOTE_DIR.test(o.nodeDir) || o.nodeDir.split('/').includes('..')) {
    throw new TypeError('вузол: недопустимий каталог');
  }
  const where = { project: o.project, nodeDir: o.nodeDir, local };
  /** @param {string} name */
  const fileOf = (name) => (local ? path.join(o.nodeDir, name) : path.posix.join(o.nodeDir, name));

  /** @param {string} envFile @param {string[]} args @param {number} [timeoutMs] */
  const compose = (envFile, args, timeoutMs = COMPOSE_TIMEOUT_MS) => t.exec(composeArgv(where, envFile, args), { timeoutMs });

  /**
   * Атомарний запис файлу вузла (`<file>.tmp` → `mv`). Лише файли ops: Compose-файл і файли інтерполяції.
   * @param {string} name
   * @param {string} content
   */
  async function writeFile(name, content) {
    if (![COMPOSE_FILE, CURRENT_ENV, NEXT_ENV].includes(name)) throw new TypeError(`вузол: запис ${name} не дозволений`);
    const file = fileOf(name);
    if (local) {
      fs.mkdirSync(o.nodeDir, { recursive: true });
      fs.writeFileSync(`${file}.tmp`, content, { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(`${file}.tmp`, file);
      return;
    }
    const argv = ['sh', '-c', WRITE_SCRIPT, '_', file];
    const r = await t.exec(argv, { input: content, allow: [...argv], timeoutMs: READ_TIMEOUT_MS });
    if (r.code !== 0) throw new Error(`вузол: запис ${name} завершився з кодом ${r.code}`);
  }

  /** @param {string} name @returns {Promise<string>} порожній рядок, коли файлу немає */
  async function readFile(name) {
    const file = fileOf(name);
    if (local) return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    const argv = ['sh', '-c', READ_SCRIPT, '_', file];
    const r = await t.exec(argv, { allow: [...argv], timeoutMs: READ_TIMEOUT_MS });
    if (r.code !== 0) throw new Error(`вузол: читання ${name} завершилося з кодом ${r.code}`);
    return r.stdout;
  }

  /** @param {string} sha */
  const envContent = (sha) => {
    if (!SHA40.test(sha)) throw new TypeError('вузол: потрібен повний SHA образу');
    return `T2F_ENV=${o.env}\nT2F_SERVER_SHA=${sha}\n`;
  };

  /** Одна перевірка здоров’я зсередини контейнера сервера (A5): рядок `<status> <commit>`. @param {string} envFile */
  const probeOnce = async (envFile) =>
    compose(envFile, ['exec', '-T', 'server', 'node', 'scripts/health-probe.mjs'], PROBE_CALL_TIMEOUT_MS);

  /** @param {string} envFile */
  async function ensureTunnel(envFile) {
    let hasToken;
    if (local) {
      const file = fileOf(TUNNEL_ENV);
      // Читаємо без виводу: значення не покидає цієї функції.
      hasToken = fs.existsSync(file) && /^TUNNEL_TOKEN=\S/m.test(fs.readFileSync(file, 'utf8'));
    } else {
      const argv = ['grep', '-q', TUNNEL_TOKEN_RE, fileOf(TUNNEL_ENV)];
      hasToken = (await t.exec(argv, { allow: [...argv], timeoutMs: READ_TIMEOUT_MS })).code === 0;
    }
    if (!hasToken) return { code: 0, started: false };
    const r = await compose(envFile, ['up', '-d', '--no-deps', 'cloudflared']);
    return { code: r.code, started: r.code === 0, result: r };
  }

  return {
    transport: t,
    nodeDir: o.nodeDir,
    project: o.project,
    fileOf,
    /** Argv Compose для цього вузла (для перевірок і зонда). @param {string} envFile @param {string[]} args */
    argv: (envFile, args) => composeArgv(where, envFile, args),

    /**
     * Вільні байти диска Docker. Вузол — `df -Pk /var/lib/docker`; локально — диск віртуальної машини Docker Desktop
     * через одноразовий контейнер закріпленого образу postgres із Compose-файлу коміту.
     * @param {string} composeText
     * @returns {Promise<{ code: 0, bytes: number } | { code: 2, message: string }>}
     */
    async freeBytes(composeText) {
      let r;
      if (local) {
        const img = serviceImage(composeText, 'postgres');
        if (!img || !RE_PINNED.test(img)) return { code: 2, message: 'образ postgres у compose.yml не закріплений дайджестом' };
        r = await t.exec(['docker', 'run', '--rm', '--entrypoint', 'df', img, '-Pk', '/'], { timeoutMs: COMPOSE_TIMEOUT_MS });
      } else {
        r = await t.exec(['df', '-Pk', '/var/lib/docker'], { timeoutMs: READ_TIMEOUT_MS });
      }
      const bytes = r.code === 0 ? parseDfAvailable(r.stdout) : null;
      if (bytes === null) return { code: 2, message: `не вдалося виміряти вільне місце (код ${r.code})` };
      if (bytes < MIN_FREE_BYTES) {
        const gb = (bytes / 1024 ** 3).toFixed(1);
        return { code: 2, message: `на вузлі вільно ${gb} ГБ, потрібно щонайменше 5 ГБ` };
      }
      return { code: 0, bytes };
    },

    /** Compose-файл коміту на вузол. @param {string} composeText */
    uploadCompose: (composeText) => writeFile(COMPOSE_FILE, composeText),

    /** Поточний образ вузла з `current.env`; немає — `null`. */
    readCurrent: async () => parseCurrentSha(await readFile(CURRENT_ENV)),

    /** Файл інтерполяції для образу, що розгортається. @param {string} sha */
    prepare: (sha) => writeFile(NEXT_ENV, envContent(sha)),

    /** Після успішної заміни (чи відкату): `current.env` = цей образ. @param {string} sha */
    setCurrent: (sha) => writeFile(CURRENT_ENV, envContent(sha)),

    /**
     * Postgres і Redis угору, потім міграції коміту одноразовим контейнером образу (`next.env`).
     * @returns {Promise<StepResult>}
     */
    async migrate() {
      const up = await compose(NEXT_ENV, ['up', '-d', '--wait', 'postgres', 'redis']);
      if (up.code !== 0) return { code: 1, message: `postgres/redis не піднялися (код ${up.code})`, detail: up.stderr };
      const r = await compose(NEXT_ENV, ['run', '--rm', '--no-deps', 'server', 'pnpm', 'migrate'], MIGRATE_TIMEOUT_MS);
      return r.code === 0 ? { code: 0 } : { code: 1, message: `міграції завершилися з кодом ${r.code}`, detail: `${r.stdout}\n${r.stderr}` };
    },

    /**
     * Перестворює контейнер сервера з образу файлу інтерполяції, потім тунель (якщо в `cloudflared.env` є токен).
     * @param {string} envFile `next.env` — новий образ; `current.env` — повернення на попередній
     * @returns {Promise<StepResult>}
     */
    async swap(envFile) {
      const r = await compose(envFile, ['up', '-d', '--no-deps', '--force-recreate', 'server']);
      if (r.code !== 0) return { code: 1, message: `заміна контейнера сервера завершилася з кодом ${r.code}`, detail: r.stderr };
      const tunnel = await ensureTunnel(envFile);
      if (tunnel.code !== 0) return { code: 1, message: `cloudflared не запустився (код ${tunnel.code})` };
      return { code: 0 };
    },

    /**
     * Щосекунди `health-probe.mjs` усередині контейнера сервера, доки не надрукує `200 <sha>`, але не довше `timeoutMs`.
     * @param {string} envFile
     * @param {string} sha
     * @param {number} [timeoutMs]
     * @returns {Promise<StepResult>}
     */
    async waitHealthy(envFile, sha, timeoutMs = HEALTH_TIMEOUT_MS) {
      const want = `200 ${sha}`;
      const startedAt = clock.now();
      let last = '';
      for (;;) {
        const r = await probeOnce(envFile);
        const lines = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (r.code === 0 && lines.includes(want)) return { code: 0 };
        last = lines[lines.length - 1] ?? `код ${r.code}`;
        if (clock.now() - startedAt + HEALTH_EVERY_MS > timeoutMs) {
          return { code: 1, message: `сервер не відповів 200 з ${sha.slice(0, 12)} за ${Math.round(timeoutMs / 1000)} с (останнє: ${last.slice(0, 80)})` };
        }
        await clock.sleep(HEALTH_EVERY_MS);
      }
    },

    /** Перевірка для зонда простою локальної цілі (W17 `check`): будь-яка відповідь 200. */
    healthCheck: async () => (await probeOnce(NEXT_ENV)).code === 0,
  };
}

/** @typedef {ReturnType<typeof createNode>} NodeOps */
