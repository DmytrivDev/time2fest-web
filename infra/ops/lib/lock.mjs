// @ts-check
// Замок вузла `deploy-<env>` (AC-17): друга команда розгортання чи відкату того самого середовища відмовляє одразу,
// нічого не змінюючи, і ніколи не чекає. Замок не переживає свого власника (EC-2):
// - на вузлі — дочірній `ssh … flock -n -E 75 <nodeDir>/deploy.lock sh -c 'echo locked; exec cat'`: замок тримається,
//   доки відкритий вхід дитини; закрили вхід чи обірвалося з’єднання — `cat` завершується, `flock` знімається;
// - локально — атомарний `mkdir <stateDir>/deploy.lock` + `owner.json { pid, at }`; власник із мертвим pid
//   витісняється; знімається в `release`, на `exit` і на SIGINT/SIGTERM.
import fs from 'node:fs';
import path from 'node:path';
import { ENVS } from './config.mjs';

/** Код `flock -E`, коли замок зайнятий. */
export const FLOCK_BUSY = 75;
export const HOLDER_SCRIPT = 'echo locked; exec cat';
const RE_REMOTE_DIR = /^\/[A-Za-z0-9_./-]+$/;
/** Каталог замка без `owner.json` старший за це — недороблений замок упалого процесу. */
const OWNERLESS_STALE_MS = 60_000;

/**
 * @typedef {{ code: 0, release: () => Promise<void>, held: () => boolean }} LockHeld
 * @typedef {{ code: 2, message: string }} LockRefused
 * @typedef {{
 *   stateDir?: string,
 *   nodeDir?: string,
 *   ackTimeoutMs?: number,
 *   signals?: boolean,
 * }} LockOpts `stateDir` — локальний каталог стану (для транспорту `local`, обов’язковий);
 *   `nodeDir` — каталог на вузлі (за замовчуванням `ENVS[env].nodeDir`); `signals: false` — не чіпати обробники сигналів.
 */

/** @param {string} env @returns {LockRefused} */
const busy = (env) => ({ code: 2, message: `замок deploy-${env} зайнятий` });

/**
 * Бере замок середовища або відмовляє одразу.
 * @param {import('./exec.mjs').Transport} transport
 * @param {string} env
 * @param {LockOpts} [opts]
 * @returns {Promise<LockHeld | LockRefused>}
 */
export async function acquireNodeLock(transport, env, opts = {}) {
  if (!Object.hasOwn(ENVS, env)) return { code: 2, message: 'замок: невідоме середовище' };
  if (transport.kind === 'local') {
    if (!opts.stateDir || !path.isAbsolute(opts.stateDir)) return { code: 2, message: `замок deploy-${env}: потрібен абсолютний каталог стану` };
    return acquireLocal(opts.stateDir, env, opts.signals ?? true);
  }
  const nodeDir = opts.nodeDir ?? ENVS[env].nodeDir;
  if (!nodeDir) return { code: 2, message: `замок deploy-${env}: у середовища немає вузла` };
  if (!RE_REMOTE_DIR.test(nodeDir) || nodeDir.split('/').includes('..')) return { code: 2, message: `замок deploy-${env}: недопустимий каталог вузла` };
  return acquireRemote(transport, env, nodeDir, opts.ackTimeoutMs ?? 30_000);
}

/**
 * Argv власника замка на вузлі (без ssh): фіксована форма.
 * @param {string} nodeDir
 */
export function holderArgv(nodeDir) {
  return ['flock', '-n', '-E', String(FLOCK_BUSY), `${nodeDir}/deploy.lock`, 'sh', '-c', HOLDER_SCRIPT];
}

/**
 * @param {import('./exec.mjs').Transport} transport
 * @param {string} env
 * @param {string} nodeDir
 * @param {number} ackTimeoutMs
 * @returns {Promise<LockHeld | LockRefused>}
 */
async function acquireRemote(transport, env, nodeDir, ackTimeoutMs) {
  if (!transport.start) return { code: 2, message: `замок deploy-${env}: транспорт не тримає процес` };
  const argv = holderArgv(nodeDir);
  const h = transport.start(argv, { stdin: true, allow: [...argv] });
  let alive = true;
  const exited = h.done.then((r) => {
    alive = false;
    return r;
  });

  /** @type {Promise<boolean>} */
  const locked = new Promise((resolve) => {
    let buf = '';
    h.stdout.setEncoding('utf8');
    /** @param {string} d */
    const onData = (d) => {
      buf = (buf + d).slice(-256);
      if (/(?:^|\n)locked\r?\n/.test(buf)) {
        h.stdout.off('data', onData);
        h.stdout.resume(); // далі вивід не потрібен, але читаємо, щоб дитина не стала
        resolve(true);
      }
    };
    h.stdout.on('data', onData);
    h.stdout.on('error', () => {});
    exited.then(() => resolve(false));
  });

  /** @type {NodeJS.Timeout | undefined} */
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve('timeout'), ackTimeoutMs);
  });
  const first = await Promise.race([locked, timeout]);
  clearTimeout(timer);

  if (first === true && alive) {
    let released = false;
    return {
      code: 0,
      held: () => alive && !released,
      async release() {
        if (released) return;
        released = true;
        h.stdin?.end(); // EOF → віддалений `cat` завершується → `flock` знімає замок
        /** @type {NodeJS.Timeout | undefined} */
        let t;
        const late = new Promise((resolve) => {
          t = setTimeout(() => resolve('late'), 10_000);
        });
        if ((await Promise.race([exited, late])) === 'late') h.kill();
        clearTimeout(t);
      },
    };
  }

  if (first === 'timeout') {
    h.kill();
    return { code: 2, message: `замок deploy-${env}: вузол не підтвердив замок` };
  }
  const r = await exited;
  if (r.code === FLOCK_BUSY) return busy(env);
  return { code: 2, message: `замок deploy-${env}: не вдалося взяти (код ${r.code})` };
}

/** @param {number} pid */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/** @param {string} lockDir @returns {string | null} */
function readOwner(lockDir) {
  try {
    return fs.readFileSync(path.join(lockDir, 'owner.json'), 'utf8');
  } catch {
    return null;
  }
}

/**
 * Чи замок покинутий: власник мертвий, або `owner.json` немає й каталог старий.
 * @param {string} lockDir
 * @param {string | null} raw
 */
function isStale(lockDir, raw) {
  if (raw === null) {
    try {
      return Date.now() - fs.statSync(lockDir).mtimeMs > OWNERLESS_STALE_MS;
    } catch {
      return false;
    }
  }
  try {
    const pid = JSON.parse(raw).pid;
    return Number.isInteger(pid) && pid > 0 && !isAlive(pid);
  } catch {
    return false; // зіпсований власник — не витісняємо, відмовляємо
  }
}

/**
 * Витісняє покинутий замок: атомарне перейменування, потім звірка, що перенесли саме той замок, який бачили.
 * Дві команди, що витісняють одночасно: перейменування вдасться лише одній.
 * @param {string} lockDir
 */
function takeOver(lockDir) {
  const seen = readOwner(lockDir);
  if (!isStale(lockDir, seen)) return false;
  const aside = `${lockDir}.stale-${process.pid}-${Date.now()}`;
  try {
    fs.renameSync(lockDir, aside);
  } catch {
    return false;
  }
  if (readOwner(aside) !== seen) {
    // Між читанням і перейменуванням замок узяв живий власник — повертаємо його на місце.
    try {
      fs.renameSync(aside, lockDir);
    } catch {
      // місце вже зайняте — живий власник лишається власником нового каталогу
    }
    return false;
  }
  fs.rmSync(aside, { recursive: true, force: true });
  return true;
}

/**
 * @param {string} stateDir
 * @param {string} env
 * @param {boolean} signals
 * @returns {LockHeld | LockRefused}
 */
function acquireLocal(stateDir, env, signals) {
  const lockDir = path.join(stateDir, 'deploy.lock');
  try {
    fs.mkdirSync(stateDir, { recursive: true });
  } catch (e) {
    return { code: 2, message: `замок deploy-${env}: каталог стану недоступний (${/** @type {NodeJS.ErrnoException} */ (e).code})` };
  }

  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      fs.mkdirSync(lockDir);
    } catch (e) {
      const code = /** @type {NodeJS.ErrnoException} */ (e).code;
      if (code !== 'EEXIST') return { code: 2, message: `замок deploy-${env}: не вдалося створити (${code})` };
      if (attempt === 0 && takeOver(lockDir)) continue;
      return busy(env);
    }
    const owner = JSON.stringify({ pid: process.pid, at: new Date().toISOString() });
    fs.writeFileSync(path.join(lockDir, 'owner.json'), owner, { mode: 0o600 });
    return holdLocal(lockDir, owner, signals);
  }
  return busy(env);
}

/**
 * @param {string} lockDir
 * @param {string} owner
 * @param {boolean} signals
 * @returns {LockHeld}
 */
function holdLocal(lockDir, owner, signals) {
  let released = false;
  const releaseSync = () => {
    if (released) return;
    released = true;
    if (signals) {
      process.off('exit', releaseSync);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
    }
    // Знімаємо лише свій замок: якщо нас витіснили, чужий каталог не чіпаємо.
    if (readOwner(lockDir) === owner) fs.rmSync(lockDir, { recursive: true, force: true });
  };
  /** @param {NodeJS.Signals} sig */
  function onSignal(sig) {
    releaseSync();
    // Інших обробників немає — відтворюємо типову поведінку (завершення за сигналом).
    if (process.listenerCount(sig) === 0) process.kill(process.pid, sig);
  }
  if (signals) {
    process.once('exit', releaseSync);
    process.once('SIGINT', onSignal);
    process.once('SIGTERM', onSignal);
  }
  return {
    code: 0,
    held: () => !released && readOwner(lockDir) === owner,
    release: async () => releaseSync(),
  };
}
