// @ts-check
// AC-17 (друга команда того самого середовища відмовляє з назвою замка), EC-2 (замок не переживає власника).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localTransport, sshBaseArgs, sshTransport } from '../lib/exec.mjs';
import { acquireNodeLock, FLOCK_BUSY } from '../lib/lock.mjs';

let stateDir = '';
beforeEach(() => {
  stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-lock-'));
});
afterEach(() => {
  fs.rmSync(stateDir, { recursive: true, force: true });
});

const lockDir = () => path.join(stateDir, 'deploy.lock');

describe('local lock', () => {
  it('a second acquire on the same state dir refuses at once with code 2 naming deploy-rehearsal', async () => {
    const first = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    expect(first.code).toBe(0);
    const second = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    expect(second).toEqual({ code: 2, message: 'замок deploy-rehearsal зайнятий' });
    // Перша команда й далі тримає замок; після звільнення його можна взяти знову.
    expect(first.code === 0 && first.held()).toBe(true);
    if (first.code === 0) await first.release();
    expect(fs.existsSync(lockDir())).toBe(false);
    const third = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    expect(third.code).toBe(0);
    if (third.code === 0) await third.release();
  });

  it('owner.json records pid and time', async () => {
    const l = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    const owner = JSON.parse(fs.readFileSync(path.join(lockDir(), 'owner.json'), 'utf8'));
    expect(owner.pid).toBe(process.pid);
    expect(Number.isNaN(Date.parse(owner.at))).toBe(false);
    if (l.code === 0) await l.release();
  });

  it('a lock whose owner pid is dead is taken over', async () => {
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    expect(dead).toBeGreaterThan(0);
    fs.mkdirSync(lockDir());
    fs.writeFileSync(path.join(lockDir(), 'owner.json'), JSON.stringify({ pid: dead, at: '2026-11-17T00:00:00.000Z' }));
    const l = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    expect(l.code).toBe(0);
    expect(JSON.parse(fs.readFileSync(path.join(lockDir(), 'owner.json'), 'utf8')).pid).toBe(process.pid);
    expect(fs.readdirSync(stateDir)).toEqual(['deploy.lock']); // витіснений каталог прибрано
    if (l.code === 0) await l.release();
  });

  it('a live foreign owner, a fresh ownerless lock and a damaged owner.json are never taken over', async () => {
    fs.mkdirSync(lockDir());
    expect((await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false })).code).toBe(2);
    fs.writeFileSync(path.join(lockDir(), 'owner.json'), '{not json');
    expect((await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false })).code).toBe(2);
    fs.writeFileSync(path.join(lockDir(), 'owner.json'), JSON.stringify({ pid: process.ppid, at: '2026-11-17T00:00:00.000Z' }));
    expect((await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false })).code).toBe(2);
    expect(fs.existsSync(lockDir())).toBe(true);
  });

  it('release never removes a lock that now belongs to someone else', async () => {
    const l = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir, signals: false });
    const foreign = JSON.stringify({ pid: process.ppid, at: '2026-11-17T00:00:00.000Z' });
    fs.writeFileSync(path.join(lockDir(), 'owner.json'), foreign);
    expect(l.code === 0 && l.held()).toBe(false);
    if (l.code === 0) await l.release();
    expect(fs.readFileSync(path.join(lockDir(), 'owner.json'), 'utf8')).toBe(foreign);
  });

  it('registers exit/SIGINT/SIGTERM handlers while held and removes them on release', async () => {
    const before = ['exit', 'SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s));
    const l = await acquireNodeLock(localTransport(), 'rehearsal', { stateDir });
    expect(['exit', 'SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s))).toEqual(before.map((n) => n + 1));
    if (l.code === 0) await l.release();
    expect(['exit', 'SIGINT', 'SIGTERM'].map((s) => process.listenerCount(s))).toEqual(before);
  });

  it('an env without a node or an unknown env is refused; a relative state dir is refused', async () => {
    expect((await acquireNodeLock(localTransport(), 'staging', { stateDir })).code).toBe(2);
    expect((await acquireNodeLock(localTransport(), 'rehearsal', { stateDir: 'rel/dir' })).code).toBe(2);
  });
});

describe('remote lock', () => {
  const SSH = { host: '203.0.113.10', user: 'deploy', knownHostsFile: '/tmp/known_hosts' };

  /**
   * Підставний запуск ssh: записує argv і грає заданий сценарій власника замка.
   * @param {'locked' | 'busy'} mode
   */
  function fakeStarter(mode) {
    /** @type {{ file: string, args: string[], stdin: boolean | undefined }[]} */
    const started = [];
    /** @type {(code: number) => void} */
    let exit = () => {};
    /** @type {typeof import('../lib/exec.mjs').start} */
    const starter = (file, args, opts = {}) => {
      started.push({ file, args, stdin: opts.stdin });
      const stdout = new PassThrough();
      const stdin = new PassThrough();
      /** @type {Promise<import('../lib/exec.mjs').RunResult>} */
      const done = new Promise((resolve) => {
        exit = (code) => {
          stdout.end();
          resolve({ code, stdout: '', stderr: '' });
        };
      });
      if (mode === 'locked') {
        stdout.write('locked\n');
        stdin.on('finish', () => exit(0)); // вхід закрито → `cat` і `flock` завершуються
      } else {
        setImmediate(() => exit(FLOCK_BUSY));
      }
      return { stdout, stdin, done, kill: () => exit(143) };
    };
    return { started, starter, drop: (/** @type {number} */ code) => exit(code) };
  }

  it('the holder argv is the fixed ssh form with a quoted flock command and an open stdin', async () => {
    const f = fakeStarter('locked');
    const t = sshTransport(SSH, undefined, f.starter);
    const l = await acquireNodeLock(t, 'rehearsal');
    expect(l.code).toBe(0);
    expect(f.started).toHaveLength(1);
    expect(f.started[0].file).toBe('ssh');
    expect(f.started[0].stdin).toBe(true);
    expect(f.started[0].args).toEqual([
      ...sshBaseArgs(SSH),
      "'flock' '-n' '-E' '75' '/srv/t2f/rehearsal/deploy.lock' 'sh' '-c' 'echo locked; exec cat'",
    ]);
    expect(l.code === 0 && l.held()).toBe(true);
    if (l.code === 0) await l.release();
    expect(l.code === 0 && l.held()).toBe(false);
  });

  it('flock exit 75 → code 2 naming deploy-rehearsal', async () => {
    const f = fakeStarter('busy');
    const l = await acquireNodeLock(sshTransport(SSH, undefined, f.starter), 'rehearsal');
    expect(l).toEqual({ code: 2, message: 'замок deploy-rehearsal зайнятий' });
  });

  it('a dropped connection means the lock is no longer held', async () => {
    const f = fakeStarter('locked');
    const l = await acquireNodeLock(sshTransport(SSH, undefined, f.starter), 'rehearsal');
    f.drop(255);
    await new Promise((r) => setImmediate(r));
    expect(l.code === 0 && l.held()).toBe(false);
  });

  it('no acknowledgement in time → refusal and the holder is killed', async () => {
    let killed = false;
    /** @type {typeof import('../lib/exec.mjs').start} */
    const silent = () => ({
      stdout: new PassThrough(),
      stdin: new PassThrough(),
      done: new Promise(() => {}),
      kill: () => {
        killed = true;
      },
    });
    const l = await acquireNodeLock(sshTransport(SSH, undefined, silent), 'rehearsal', { ackTimeoutMs: 20 });
    expect(l.code).toBe(2);
    expect(killed).toBe(true);
  });

  it('prelaunch has no node → refusal before any ssh call', async () => {
    const f = fakeStarter('locked');
    expect((await acquireNodeLock(sshTransport(SSH, undefined, f.starter), 'prelaunch')).code).toBe(2);
    expect(f.started).toHaveLength(0);
  });
});
