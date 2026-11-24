// @ts-check
// SPEC-13b W45 — години нічного розміру в рядок витрат `server` ([П-6], AC-63): після `night` — 0 год зі ставкою
// надбавки, після `back` — години від `night` з журналу потужності; запис — `pnpm run ops spend-record` у контейнері
// сервера на основному вузлі; невдалий запис не робить зміну розміру невдалою; попередження у вікні копії :50–:10.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProvider, FAKE_ENV_SIZES } from '../lib/capacity/fake.mjs';
import { backupWindowWarning, inBackupWindow, spendOf } from '../lib/capacity/spendRecord.mjs';
import { main } from '../ops.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const MAIN = { name: 't2f-rehearsal-main', size: 's-2vcpu-4gb', tags: ['t2f-managed', 't2f-env-rehearsal', 't2f-role-main'], publicIp: '203.0.113.21' };
const NIGHT = ['capacity', '--env', 'rehearsal', 'night', '--size', 's-4vcpu-8gb', '--confirm', 'rehearsal'];
const BACK = ['capacity', '--env', 'rehearsal', 'back', '--confirm', 'rehearsal'];

/** @type {string[]} */
const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** @param {{ failRecord?: boolean }} [o] */
function world(o = {}) {
  const fake = createFakeProvider({ nodes: [MAIN] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-capacity-spend-'));
  temps.push(dir);
  /** @type {string[]} */ const out = [];
  /** @type {string[]} */ const err = [];
  /** @type {{ host: string, argv: string[] }[]} */ const remote = [];
  const clock = { now: () => 0, sleep: async () => {} };
  const state = { now: new Date('2026-12-31T20:30:00.000Z') };
  const deps = /** @type {any} */ ({
    out: (/** @type {string} */ l) => out.push(l),
    err: (/** @type {string} */ l) => err.push(l),
    env: {},
    exec: { run: async () => ({ code: 0, stdout: '', stderr: '' }) },
    now: () => state.now,
    clock,
    provider: async () => ({ name: 'fake', provider: fake.provider, envSizes: FAKE_ENV_SIZES }),
    paths: { stateRoot: dir },
    transport: (/** @type {{ host: string }} */ ssh) => ({
      kind: 'ssh',
      describe: `ssh:${ssh.host}`,
      exec: async (/** @type {string[]} */ argv) => {
        remote.push({ host: ssh.host, argv });
        return { code: o.failRecord ? 1 : 0, stdout: '', stderr: '' };
      },
    }),
    ...FAKE_TARGET,
  });
  return { out, err, remote, deps, state };
}

/** @param {string[]} argv */
const spendArgs = (argv) => argv.slice(argv.indexOf('spend-record'));

describe('capacity night/back → spend-record server (AC-63)', () => {
  it('night records 0 h with the extra hourly rate; back records the hours since night', async () => {
    const w = world();
    expect(await main(NIGHT, w.deps), w.err.join('\n')).toBe(0);
    expect(w.remote).toHaveLength(1);
    expect(w.remote[0].host).toBe('203.0.113.21');
    expect(w.remote[0].argv.slice(0, 4)).toEqual(['docker', 'compose', '-p', 't2f-rehearsal']);
    expect(w.remote[0].argv).toEqual(expect.arrayContaining(['exec', '-T', 'server', 'pnpm', 'run', 'ops']));
    // Надбавка s-4vcpu-8gb над s-2vcpu-4gb: 0.07143 − 0.03571.
    expect(spendArgs(w.remote[0].argv)).toEqual(['spend-record', 'server', '--hours', '0', '--usd-per-hour', '0.03572', '--reason', 'capacity:night:s-4vcpu-8gb']);

    w.state.now = new Date('2027-01-01T03:00:00.000Z');
    expect(await main(BACK, w.deps), w.err.join('\n')).toBe(0);
    expect(w.remote).toHaveLength(2);
    expect(spendArgs(w.remote[1].argv)).toEqual(['spend-record', 'server', '--hours', '6.5', '--usd-per-hour', '0.03572', '--reason', 'capacity:back:s-4vcpu-8gb']);
  });

  it('nothing to resize → no record', async () => {
    const w = world();
    expect(await main(BACK, w.deps)).toBe(0);
    expect(w.remote).toEqual([]);
  });

  it('a failed record keeps the resize successful and prints the manual command', async () => {
    const w = world({ failRecord: true });
    expect(await main(NIGHT, w.deps)).toBe(0);
    expect(w.err.join('\n')).toContain('pnpm run ops spend-record server --hours 0 --usd-per-hour 0.03572 --reason capacity:night:s-4vcpu-8gb');
  });

  it('warns once inside the hourly backup window (:50–:10 Kyiv), not outside', async () => {
    const inside = world();
    inside.state.now = new Date('2026-12-31T20:55:00.000Z');
    expect(await main(NIGHT, inside.deps)).toBe(0);
    expect(inside.err.filter((l) => l.includes('годинною копією'))).toHaveLength(1);
    const outside = world();
    expect(await main(NIGHT, outside.deps)).toBe(0);
    expect(outside.err.join('\n')).not.toContain('годинною копією');
  });
});

describe('spend helpers', () => {
  const priceOf = (/** @type {string} */ s) => ({ small: 0.02, big: 0.1 })[s];
  it('back without a preceding night → 0 h; the night after the last back counts', () => {
    expect(spendOf({ action: 'back', nightSize: undefined, journal: [], nowMs: 0, priceOf, offSeason: 'small' })).toEqual({ hours: 0, usdPerHour: 0, size: null });
    const journal = [
      { step: 'resize', result: 'ok', action: 'night', to: 'big', at: '2026-12-30T00:00:00.000Z' },
      { step: 'resize', result: 'ok', action: 'back', to: 'small', at: '2026-12-30T02:00:00.000Z' },
      { step: 'resize', result: 'ok', action: 'night', to: 'big', at: '2026-12-31T20:00:00.000Z' },
      { step: 'resize', result: 'ok', action: 'back', to: 'small', at: '2027-01-01T04:00:00.000Z' },
    ];
    expect(spendOf({ action: 'back', nightSize: undefined, journal, nowMs: Date.parse('2027-01-01T04:00:00.000Z'), priceOf, offSeason: 'small' })).toEqual({ hours: 8, usdPerHour: 0.08, size: 'big' });
  });

  it('the window is :50 … :09', () => {
    expect(inBackupWindow(new Date('2026-12-31T20:50:00Z'))).toBe(true);
    expect(inBackupWindow(new Date('2026-12-31T21:09:59Z'))).toBe(true);
    expect(inBackupWindow(new Date('2026-12-31T21:10:00Z'))).toBe(false);
    expect(backupWindowWarning('plan', new Date('2026-12-31T20:55:00Z'))).toBeNull();
  });
});
