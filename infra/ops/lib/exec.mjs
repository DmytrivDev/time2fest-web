// @ts-check
// Запуск дочірніх процесів і транспорти (локальний, SSH). Лише `shell:false`; жоден аргумент не потрапляє
// в рядок оболонки локально (AC-10). На вузол — один рядок команди, де кожен елемент у одинарних лапках (`shq`)
// і проходить перелік дозволеного виклику. Шими `.cmd`/`.bat` не запускаються: Node-інструменти — `node <js>`.
import { spawn } from 'node:child_process';
import { isIPv4 } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hasControl, isHostName } from './args.mjs';
import { FORBIDDEN_TARGETS } from './config.mjs';

/** Корінь репозиторію (worktree). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/** Точки входу Node-інструментів відносно кореня (як `workers/edge/scripts/deploy.mjs`). */
export const NODE_TOOLS = /** @type {const} */ ({
  wrangler: 'node_modules/wrangler/bin/wrangler.js',
  next: 'node_modules/next/dist/bin/next',
});

/** Скільки чекати після SIGTERM до SIGKILL, коли спливає `timeoutMs`. */
const KILL_GRACE_MS = 5_000;
export const CODE_TIMEOUT = 124;
export const CODE_SPAWN_FAILED = 127;

/** Відмова до запуску: недопустимий аргумент, файл чи ціль. Нічого не запущено. */
export class ExecRefusal extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ExecRefusal';
  }
}

/** Безпечний токен для віддаленої команди за замовчуванням: без лапок, пробілів, `$`, `;`, `|`, `&`, `` ` ``, `*`. */
export const SAFE_TOKEN = /^[A-Za-z0-9_@%+=:,./-]+$/;
export const SHA40 = /^[0-9a-f]{40}$/;
export const DEFAULT_REMOTE_ALLOW = [SAFE_TOKEN];

/**
 * @typedef {string | RegExp} AllowEntry Рядок — точний збіг; RegExp — збіг усього елемента.
 * @typedef {{
 *   input?: string | import('node:stream').Readable,
 *   stdout?: import('node:stream').Writable,
 *   timeoutMs?: number,
 *   env?: NodeJS.ProcessEnv,
 *   cwd?: string,
 *   onLine?: (stream: 'stdout' | 'stderr', line: string) => void,
 *   allow?: AllowEntry[],
 * }} RunOpts
 * `stdout` — потік, куди йде вивід дитини (тоді `stdout` у результаті порожній); `onLine` — кожен повний рядок
 * (роздільник `\r?\n`); `allow` — перелік дозволеного для транспорту.
 * @typedef {{ code: number, stdout: string, stderr: string, timedOut?: boolean }} RunResult
 * @typedef {{ kind: 'local' | 'ssh', describe: string, exec: (argv: string[], opts?: RunOpts) => Promise<RunResult> }} Transport
 */

/**
 * Кожен елемент — рядок без переводу рядка і NUL. Інакше — відмова до запуску.
 * @param {unknown[]} argv
 */
export function assertArgv(argv) {
  for (const a of argv) {
    if (typeof a !== 'string') throw new ExecRefusal('аргумент команди не є рядком');
    if (a.includes('\n') || a.includes('\r') || a.includes('\0')) {
      throw new ExecRefusal('аргумент команди містить перевод рядка або NUL');
    }
  }
}

/**
 * Кожен елемент має збігтися хоча б з одним записом переліку.
 * @param {string[]} argv
 * @param {AllowEntry[]} allow
 */
export function assertAllowed(argv, allow) {
  argv.forEach((a, i) => {
    const ok = allow.some((e) => {
      if (typeof e === 'string') return a === e;
      const m = a.match(new RegExp(e.source, e.flags.replace('g', '').replace('y', '')));
      return m !== null && m.index === 0 && m[0] === a;
    });
    if (!ok) throw new ExecRefusal(`аргумент №${i} команди не дозволений для цього виклику`);
  });
}

/**
 * POSIX-лапки: увесь елемент в одинарних лапках, `'` → `'\''`.
 * @param {string} s
 */
export function shq(s) {
  return `'${String(s).split("'").join("'\\''")}'`;
}

/**
 * Запускає `file args` без оболонки.
 * @param {string} file
 * @param {string[]} args
 * @param {RunOpts} [opts]
 * @returns {Promise<RunResult>}
 */
export function run(file, args, opts = {}) {
  assertArgv([file, ...args]);
  if (/\.(cmd|bat)$/i.test(file)) throw new ExecRefusal('шими .cmd/.bat не запускаються: Node-інструменти — через process.execPath');
  if (opts.allow) assertAllowed(args, opts.allow);

  return new Promise((resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(file, args, {
        shell: false,
        windowsHide: true,
        env: opts.env ?? process.env,
        cwd: opts.cwd,
        stdio: [opts.input !== undefined ? 'pipe' : 'ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      resolve({ code: CODE_SPAWN_FAILED, stdout: '', stderr: `не вдалося запустити ${path.basename(file)}: ${errCode(e)}` });
      return;
    }

    /** @type {Record<'stdout' | 'stderr', string>} */
    const text = { stdout: '', stderr: '' };
    /** @type {Record<'stdout' | 'stderr', string>} */
    const partial = { stdout: '', stderr: '' };
    let timedOut = false;
    let settled = false;

    /** @param {'stdout' | 'stderr'} name @param {string} chunk */
    const take = (name, chunk) => {
      text[name] += chunk;
      if (!opts.onLine) return;
      const parts = (partial[name] + chunk).split(/\r?\n/);
      partial[name] = /** @type {string} */ (parts.pop());
      for (const line of parts) opts.onLine(name, line);
    };
    const flush = () => {
      if (!opts.onLine) return;
      for (const name of /** @type {const} */ (['stdout', 'stderr'])) {
        if (partial[name] !== '') opts.onLine(name, partial[name].replace(/\r$/, ''));
        partial[name] = '';
      }
    };

    if (opts.stdout) child.stdout?.pipe(opts.stdout, { end: false });
    else {
      child.stdout?.setEncoding('utf8');
      child.stdout?.on('data', (d) => take('stdout', String(d)));
    }
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (d) => take('stderr', String(d)));

    if (opts.input !== undefined && child.stdin) {
      child.stdin.on('error', () => {});
      if (typeof opts.input === 'string') child.stdin.end(opts.input);
      else opts.input.pipe(child.stdin);
    }

    /** @type {NodeJS.Timeout | undefined} */
    let timer;
    /** @type {NodeJS.Timeout | undefined} */
    let killTimer;
    if (opts.timeoutMs !== undefined && opts.timeoutMs > 0) {
      timer = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
        killTimer = setTimeout(() => child.kill('SIGKILL'), KILL_GRACE_MS);
      }, opts.timeoutMs);
    }

    /** @param {RunResult} r */
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      clearTimeout(killTimer);
      flush();
      resolve(r);
    };
    child.on('error', (e) => {
      done({ code: CODE_SPAWN_FAILED, stdout: text.stdout, stderr: `${text.stderr}не вдалося запустити ${path.basename(file)}: ${errCode(e)}` });
    });
    child.on('close', (code) => {
      if (timedOut) done({ code: CODE_TIMEOUT, stdout: text.stdout, stderr: text.stderr, timedOut: true });
      else done({ code: code ?? 1, stdout: text.stdout, stderr: text.stderr });
    });
  });
}

/** @param {unknown} e */
function errCode(e) {
  return e && typeof e === 'object' && 'code' in e ? String(e.code) : 'помилка';
}

/**
 * Node-інструмент як `process.execPath <js>` (без шимів).
 * @param {keyof typeof NODE_TOOLS} tool
 * @param {string[]} args
 * @param {RunOpts} [opts]
 */
export function runNodeTool(tool, args, opts) {
  return run(process.execPath, [path.join(REPO_ROOT, NODE_TOOLS[tool]), ...args], opts);
}

/**
 * Локальний транспорт: `argv[0]` — файл, решта — аргументи, без оболонки.
 * @param {typeof run} [runner]
 * @returns {Transport}
 */
export function localTransport(runner = run) {
  return {
    kind: 'local',
    describe: 'local',
    exec(argv, opts = {}) {
      if (!argv.length) throw new ExecRefusal('порожня команда');
      assertArgv(argv);
      if (opts.allow) assertAllowed(argv, opts.allow);
      const { allow: _allow, ...rest } = opts;
      return runner(argv[0], argv.slice(1), rest);
    },
  };
}

const RE_USER = /^[a-z_][a-z0-9_-]{0,31}$/;
/** Локальний шлях, який ssh читає як значення опції: без пробілів, лапок і `%`/`~` (ssh їх розгортає). */
const RE_SSH_PATH = /^[A-Za-z0-9_.:/\\-]+$/;

/**
 * @param {string} p
 * @param {string} what
 */
function sshPath(p, what) {
  if (typeof p !== 'string' || !RE_SSH_PATH.test(p) || p.startsWith('-')) {
    throw new ExecRefusal(`${what}: шлях має містити лише A-Z, a-z, 0-9, _ . : / \\ -`);
  }
  return p.split('\\').join('/');
}

/**
 * @typedef {{
 *   host: string,
 *   user: string,
 *   keyFile?: string,
 *   knownHostsFile: string,
 *   accept?: 'strict' | 'new',
 *   sshFile?: string,
 * }} SshOpts `accept: 'new'` — лише для першого входу (bootstrap); далі ключ хоста закріплений.
 */

/**
 * Аргументи ssh до віддаленої команди. Ключ хоста завжди звіряється з `knownHostsFile`.
 * @param {SshOpts} o
 */
export function sshBaseArgs(o) {
  const host = String(o.host ?? '').toLowerCase();
  if (!(isIPv4(host) || isHostName(host))) throw new ExecRefusal('ssh: ціль не IPv4-адреса і не ім’я хоста');
  if (FORBIDDEN_TARGETS.includes(host)) throw new ExecRefusal(`ssh: заборонена ціль ${host}`);
  if (!RE_USER.test(String(o.user ?? ''))) throw new ExecRefusal('ssh: недопустиме ім’я користувача');
  const accept = o.accept ?? 'strict';
  if (accept !== 'strict' && accept !== 'new') throw new ExecRefusal('ssh: accept — strict або new');
  const args = [
    '-o', 'BatchMode=yes',
    '-o', `StrictHostKeyChecking=${accept === 'new' ? 'accept-new' : 'yes'}`,
    '-o', `UserKnownHostsFile=${sshPath(o.knownHostsFile, 'knownHostsFile')}`,
    '-o', 'ConnectTimeout=15',
    '-o', 'ServerAliveInterval=15',
    '-o', 'ServerAliveCountMax=4',
  ];
  if (o.keyFile !== undefined) args.push('-i', sshPath(o.keyFile, 'keyFile'));
  args.push(`${o.user}@${host}`, '--');
  return args;
}

/**
 * SSH-транспорт. Віддалена команда — `argv.map(shq).join(' ')`; кожен елемент спершу проходить
 * перелік дозволеного (`opts.allow`, за замовчуванням `DEFAULT_REMOTE_ALLOW`).
 * @param {SshOpts} o
 * @param {typeof run} [runner]
 * @returns {Transport}
 */
export function sshTransport(o, runner = run) {
  const base = sshBaseArgs(o);
  const file = o.sshFile ?? 'ssh';
  return {
    kind: 'ssh',
    describe: `ssh:${String(o.host).toLowerCase()}`,
    exec(argv, opts = {}) {
      if (!argv.length) throw new ExecRefusal('порожня команда');
      assertArgv(argv);
      assertAllowed(argv, opts.allow ?? DEFAULT_REMOTE_ALLOW);
      const { allow: _allow, ...rest } = opts;
      return runner(file, [...base, argv.map(shq).join(' ')], rest);
    },
  };
}

/** Справжній виконавець: те саме, що підставляє `test/support/fakeExec.mjs`. */
export const realExec = { run, localTransport: () => localTransport(), sshTransport: (/** @type {SshOpts} */ o) => sshTransport(o) };
/** @typedef {{ run: typeof run, localTransport: () => Transport, sshTransport: (o: SshOpts) => Transport }} Executor */
