// @ts-check
/**
 * Machine integration lock (SPEC-02 AC-13 … AC-17): shared / exclusive holders with leases,
 * takeover of stale holders and a journal. Node built-ins only.
 *
 * Files in the lock folder:
 * - `integration.json`    — `{ holders: Holder[] }`;
 * - `integration.mutex/`  — short critical section, taken with an atomic `mkdir`;
 * - `integration.journal` — `ISO\towner\tmode\tevent`, event ∈ take|release|takeover|timeout.
 *
 * Fail closed: an unreadable `integration.json` means "wait and retry", never "no holders".
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const STATE_FILE = 'integration.json';
const MUTEX_DIR = 'integration.mutex';
const JOURNAL_FILE = 'integration.journal';
const MUTEX_RETRY_MS = 100;
const MUTEX_STALE_MS = 30_000;
const POLL_MS = 500;
const RENEW_EVERY_MS = 60_000;
const DEFAULT_TIMEOUT_MS = 30 * 60_000;
const DEFAULT_STALE_MS = 60 * 60_000;

/**
 * @typedef {'shared' | 'exclusive'} LockMode
 * @typedef {'take' | 'release' | 'takeover' | 'timeout'} LockEvent
 * @typedef {{ owner: string, mode: LockMode, pid: number, startedAt: string, leaseAt: string }} Holder
 * @typedef {{ release: () => Promise<void>, renew: () => Promise<boolean> }} LockHandle
 */

class UnreadableState extends Error {}

/**
 * Lock folder without creating it: `T2F_LOCK_DIR`, else `.claude/sdd/locks` of the main checkout
 * (the parent of `git rev-parse --git-common-dir`).
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function resolveLockDir(cwd, env) {
  if (env.T2F_LOCK_DIR) return path.resolve(cwd, env.T2F_LOCK_DIR);
  const commonDir = execFileSync('git', ['rev-parse', '--git-common-dir'], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  return path.resolve(path.dirname(path.resolve(cwd, commonDir)), '.claude/sdd/locks');
}

/**
 * Lock folder, created recursively.
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @returns {string}
 */
export function lockDir(cwd, env) {
  const dir = resolveLockDir(cwd, env);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Current holders. Throws when the state file exists but cannot be read or parsed.
 * @param {string} dir
 * @returns {Holder[]}
 */
export function readHolders(dir) {
  /** @type {string} */
  let text;
  try {
    text = fs.readFileSync(path.join(dir, STATE_FILE), 'utf8');
  } catch (err) {
    if (/** @type {NodeJS.ErrnoException} */ (err).code === 'ENOENT') return [];
    throw new UnreadableState(`integration lock: cannot read ${STATE_FILE}`);
  }
  try {
    const parsed = JSON.parse(text);
    if (!parsed || !Array.isArray(parsed.holders)) throw new Error('shape');
    return /** @type {Holder[]} */ (parsed.holders);
  } catch {
    throw new UnreadableState(`integration lock: ${STATE_FILE} is not valid`);
  }
}

/**
 * @param {string} dir
 * @param {Holder[]} holders
 */
function writeHolders(dir, holders) {
  const file = path.join(dir, STATE_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  const body = JSON.stringify({ holders }, null, 2) + '\n';
  fs.writeFileSync(tmp, body);
  try {
    fs.renameSync(tmp, file);
  } catch {
    // Windows may refuse the rename while a reader has the file open; we hold the mutex, so write in place.
    fs.writeFileSync(file, body);
    fs.rmSync(tmp, { force: true });
  }
}

/**
 * @param {string} dir
 * @param {number} at
 * @param {string} owner
 * @param {LockMode} mode
 * @param {LockEvent} event
 */
function journal(dir, at, owner, mode, event) {
  fs.appendFileSync(path.join(dir, JOURNAL_FILE), `${new Date(at).toISOString()}\t${owner}\t${mode}\t${event}\n`);
}

/**
 * Runs `fn` inside the folder mutex. A mutex older than 30 s is treated as abandoned and removed.
 * @template T
 * @param {string} dir
 * @param {(ms: number) => Promise<void>} sleep
 * @param {() => T} fn
 * @returns {Promise<T>}
 */
async function withMutex(dir, sleep, fn) {
  const mutex = path.join(dir, MUTEX_DIR);
  for (;;) {
    try {
      fs.mkdirSync(mutex);
      break;
    } catch (err) {
      if (/** @type {NodeJS.ErrnoException} */ (err).code !== 'EEXIST') throw err;
      try {
        // fs mtime is wall-clock time, so compare against the wall clock, not the injected one.
        if (Date.now() - fs.statSync(mutex).mtimeMs > MUTEX_STALE_MS) {
          fs.rmSync(mutex, { recursive: true, force: true });
          continue;
        }
      } catch {
        // Released between mkdir and stat — retry at once.
        continue;
      }
      await sleep(MUTEX_RETRY_MS);
    }
  }
  try {
    return fn();
  } finally {
    fs.rmSync(mutex, { recursive: true, force: true });
  }
}

/** @param {number} ms */
const realSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * @param {string | undefined} raw
 * @param {number} fallback
 */
function msFrom(raw, fallback) {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

/**
 * Waits for and takes the integration lock.
 * - `shared` is granted while no `exclusive` holder exists; `exclusive` while there are no holders.
 * - A holder whose lease is older than `staleMs` is dropped and journalled as `takeover`.
 * - On timeout journals `timeout` and throws naming the current holder, its mode and its start.
 * @param {{
 *   dir: string,
 *   owner: string,
 *   mode: LockMode,
 *   timeoutMs?: number,
 *   staleMs?: number,
 *   now?: () => number,
 *   sleep?: (ms: number) => Promise<void>,
 *   renewEveryMs?: number,
 *   env?: Record<string, string | undefined>,
 * }} opts
 * @returns {Promise<LockHandle>}
 */
export async function acquire(opts) {
  const { dir, owner, mode } = opts;
  if (mode !== 'shared' && mode !== 'exclusive') throw new Error(`integration lock: unknown mode "${String(mode)}"`);
  const env = opts.env ?? process.env;
  const timeoutMs = opts.timeoutMs ?? msFrom(env.T2F_LOCK_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
  const staleMs = opts.staleMs ?? msFrom(env.T2F_LOCK_STALE_MS, DEFAULT_STALE_MS);
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? realSleep;
  const renewEveryMs = opts.renewEveryMs ?? RENEW_EVERY_MS;

  fs.mkdirSync(dir, { recursive: true });
  const start = now();
  /** @type {Holder | null} */
  let mine = null;
  /** @type {Holder | null} */
  let blocker = null;

  for (;;) {
    mine = await withMutex(dir, sleep, () => {
      /** @type {Holder[]} */
      let holders;
      try {
        holders = readHolders(dir);
      } catch (err) {
        if (err instanceof UnreadableState) {
          blocker = null;
          return null;
        }
        throw err;
      }
      const at = now();
      const live = holders.filter((h) => {
        const lease = Date.parse(h.leaseAt);
        const stale = !Number.isFinite(lease) || at - lease > staleMs;
        if (stale) journal(dir, at, h.owner, h.mode, 'takeover');
        return !stale;
      });
      const free = mode === 'shared' ? !live.some((h) => h.mode === 'exclusive') : live.length === 0;
      if (!free) {
        if (live.length !== holders.length) writeHolders(dir, live);
        blocker = live.find((h) => h.mode === 'exclusive') ?? live[0] ?? null;
        return null;
      }
      const iso = new Date(at).toISOString();
      /** @type {Holder} */
      const holder = { owner, mode, pid: process.pid, startedAt: iso, leaseAt: iso };
      writeHolders(dir, [...live, holder]);
      journal(dir, at, owner, mode, 'take');
      return holder;
    });
    if (mine) break;
    if (now() - start >= timeoutMs) {
      const b = /** @type {Holder | null} */ (blocker);
      journal(dir, now(), owner, mode, 'timeout');
      const minutes = Math.round(timeoutMs / 600) / 100;
      const held = b ? `${b.owner} (${b.mode}) since ${b.startedAt}` : `unknown (${STATE_FILE} unreadable)`;
      throw new Error(`integration lock: waited ${minutes} min; held by ${held}`);
    }
    await sleep(POLL_MS);
  }

  const held = /** @type {Holder} */ (mine);
  /** @param {Holder} h */
  const isMine = (h) => h.owner === held.owner && h.pid === held.pid && h.startedAt === held.startedAt;
  let released = false;

  const renew = async () => {
    if (released) return false;
    return withMutex(dir, sleep, () => {
      const holders = readHolders(dir);
      const own = holders.find(isMine);
      if (!own) return false;
      own.leaseAt = new Date(now()).toISOString();
      writeHolders(dir, holders);
      return true;
    });
  };

  const timer = renewEveryMs > 0 ? setInterval(() => void renew().catch(() => {}), renewEveryMs) : null;
  timer?.unref();

  const release = async () => {
    if (released) return;
    released = true;
    if (timer) clearInterval(timer);
    await withMutex(dir, sleep, () => {
      const holders = readHolders(dir);
      const rest = holders.filter((h) => !isMine(h));
      if (rest.length !== holders.length) writeHolders(dir, rest);
      journal(dir, now(), held.owner, held.mode, 'release');
    });
  };

  return { release, renew };
}
