import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { acquire, lockDir, readHolders, resolveLockDir } from '../../scripts/lib/lock.mjs';

const serverDir = fileURLToPath(new URL('../..', import.meta.url));
const T0 = Date.parse('2026-11-17T00:00:00.000Z');
const MIN = 60_000;

/** Injected clock: every sleep advances virtual time and yields to the event loop. */
function fakeClock(start = T0) {
  let t = start;
  return {
    now: () => t,
    sleep: async (ms: number) => {
      t += ms;
      await new Promise((r) => setImmediate(r));
    },
    advance: (ms: number) => {
      t += ms;
    },
  };
}

async function ticks(n: number) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

function journalLines(dir: string) {
  const file = path.join(dir, 'integration.journal');
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.split('\t'));
}

const norm = (p: string) => {
  const r = path.resolve(p);
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-lock-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('integration lock', () => {
  it('AC-13: a shared request waits while an exclusive holder exists and is granted after release', async () => {
    const clock = fakeClock();
    const opts = { dir, now: clock.now, sleep: clock.sleep, renewEveryMs: 0 };
    const ex = await acquire({ ...opts, owner: 'a:1', mode: 'exclusive' });

    let granted = false;
    const shared = acquire({ ...opts, owner: 'b:2', mode: 'shared' }).then((h) => {
      granted = true;
      return h;
    });
    await ticks(20);
    expect(granted).toBe(false);

    await ex.release();
    const h = await shared;
    expect(granted).toBe(true);
    expect(readHolders(dir).map((x) => [x.owner, x.mode])).toEqual([['b:2', 'shared']]);
    await h.release();
  });

  it('AC-14: an exclusive request waits for a shared holder', async () => {
    const clock = fakeClock();
    const opts = { dir, now: clock.now, sleep: clock.sleep, renewEveryMs: 0 };
    const s1 = await acquire({ ...opts, owner: 'a:1', mode: 'shared' });
    const s2 = await acquire({ ...opts, owner: 'b:2', mode: 'shared' });
    expect(readHolders(dir)).toHaveLength(2);

    let granted = false;
    const ex = acquire({ ...opts, owner: 'c:3', mode: 'exclusive' }).then((h) => {
      granted = true;
      return h;
    });
    await ticks(20);
    await s1.release();
    await ticks(20);
    expect(granted).toBe(false);

    await s2.release();
    const h = await ex;
    expect(granted).toBe(true);
    expect(readHolders(dir).map((x) => x.mode)).toEqual(['exclusive']);
    await h.release();
  });

  it('AC-15: on timeout the error names the holder, its mode and its start', async () => {
    const clock = fakeClock();
    const opts = { dir, now: clock.now, sleep: clock.sleep, renewEveryMs: 0 };
    const ex = await acquire({ ...opts, owner: 'holder:7', mode: 'exclusive' });
    const startedAt = new Date(T0).toISOString();

    await expect(acquire({ ...opts, owner: 'late:8', mode: 'shared', timeoutMs: 300 })).rejects.toThrow(
      `integration lock: waited 0.01 min; held by holder:7 (exclusive) since ${startedAt}`,
    );
    expect(journalLines(dir).at(-1)).toEqual([expect.any(String), 'late:8', 'shared', 'timeout']);
    await ex.release();
  });

  it('AC-16: a holder with a lease 61 min old is taken over and journalled with the old owner', async () => {
    const old = new Date(T0 - 61 * MIN).toISOString();
    fs.writeFileSync(
      path.join(dir, 'integration.json'),
      JSON.stringify({ holders: [{ owner: 'gone:42', mode: 'exclusive', pid: 42, startedAt: old, leaseAt: old }] }),
    );
    const clock = fakeClock();
    const h = await acquire({ dir, owner: 'next:9', mode: 'exclusive', now: clock.now, sleep: clock.sleep, renewEveryMs: 0 });

    expect(readHolders(dir).map((x) => x.owner)).toEqual(['next:9']);
    const events = journalLines(dir).map(([, owner, mode, event]) => [owner, mode, event]);
    expect(events).toEqual([
      ['gone:42', 'exclusive', 'takeover'],
      ['next:9', 'exclusive', 'take'],
    ]);
    await h.release();
  });

  it('AC-17: folder resolution, git-ignored default and one journal line per take, release and takeover', async () => {
    // Default: the main checkout (first entry of `git worktree list`) + .claude/sdd/locks. Resolved, never created.
    const list = execFileSync('git', ['worktree', 'list', '--porcelain'], { cwd: serverDir, encoding: 'utf8' });
    const main = /^worktree (.+)$/m.exec(list)?.[1];
    expect(main).toBeTruthy();
    const defaultDir = resolveLockDir(serverDir, {});
    expect(norm(defaultDir)).toBe(norm(path.join(main as string, '.claude/sdd/locks')));
    const ignored = spawnSync('git', ['check-ignore', '-q', '.claude/sdd/locks/integration.json'], { cwd: main });
    expect(ignored.status).toBe(0);

    // Override: T2F_LOCK_DIR names the folder, which is created.
    const custom = path.join(dir, 'custom');
    expect(lockDir(serverDir, { T2F_LOCK_DIR: custom })).toBe(custom);
    expect(fs.statSync(custom).isDirectory()).toBe(true);

    // Journal: take, release, takeover — one line each, with time, owner, mode, event.
    const clock = fakeClock();
    const opts = { dir: custom, now: clock.now, sleep: clock.sleep, renewEveryMs: 0 };
    const a = await acquire({ ...opts, owner: 'a:1', mode: 'shared' });
    await a.release();
    await acquire({ ...opts, owner: 'b:2', mode: 'shared' });
    clock.advance(61 * MIN);
    const c = await acquire({ ...opts, owner: 'c:3', mode: 'exclusive' });
    await c.release();

    const lines = journalLines(custom);
    expect(lines.map(([, owner, mode, event]) => `${owner} ${mode} ${event}`)).toEqual([
      'a:1 shared take',
      'a:1 shared release',
      'b:2 shared take',
      'b:2 shared takeover',
      'c:3 exclusive take',
      'c:3 exclusive release',
    ]);
    for (const l of lines) {
      expect(l).toHaveLength(4);
      expect(Number.isNaN(Date.parse(l[0] as string))).toBe(false);
    }
  });

  it('fails closed: an unreadable integration.json makes a request wait, not take', async () => {
    fs.writeFileSync(path.join(dir, 'integration.json'), '{ not json');
    const clock = fakeClock();
    await expect(
      acquire({ dir, owner: 'x:1', mode: 'exclusive', now: clock.now, sleep: clock.sleep, renewEveryMs: 0, timeoutMs: 1000 }),
    ).rejects.toThrow(/held by unknown/);
  });

  it('CLI: runs the command without a shell under the lock and exits with its code', () => {
    const custom = path.join(dir, 'cli');
    const r = spawnSync(
      process.execPath,
      ['scripts/lock.mjs', '--mode', 'shared', '--', process.execPath, '-e', 'process.exit(process.env.T2F_LOCK_MODE === "shared" ? 3 : 9)'],
      { cwd: serverDir, env: { ...process.env, T2F_LOCK_DIR: custom }, encoding: 'utf8' },
    );
    expect(r.status).toBe(3);
    expect(readHolders(custom)).toEqual([]);
    expect(journalLines(custom).map((l) => l[3])).toEqual(['take', 'release']);
  });
});
