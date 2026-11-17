// @ts-check
// AC-21 (робочий домен лише з двома прапорцями), AC-22 (стара адреса — ніколи), AC-23 (заморозка production).
import { describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { guardRun, inFreezeWindow } from '../lib/guard.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const CALM = new Date('2026-11-20T12:00:00Z');

/** @param {string[]} argv @param {Date} [at] */
async function runMain(argv, at = CALM) {
  const fake = createFakeExec();
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, { exec: fake, now: () => at, out: (l) => lines.push(l), err: (l) => lines.push(l), env: {} });
  return { code, calls: fake.calls.length, text: lines.join('\n') };
}

describe('main domain needs --confirm <env> AND --allow-main-domain (AC-21)', () => {
  /** @type {[string, string[]][]} */
  const cases = [
    ['deploy prelaunch', ['deploy', '--env', 'prelaunch']],
    ['deploy production', ['deploy', '--env', 'production']],
    ['rollback production', ['rollback', '--env', 'production']],
    ['deploy rehearsal → time2fest.com', ['deploy', '--env', 'rehearsal', '--target', 'time2fest.com']],
    ['deploy rehearsal → www', ['deploy', '--env', 'rehearsal', '--target', 'www.time2fest.com']],
    ['deploy rehearsal → admin', ['deploy', '--env', 'rehearsal', '--target', 'ADMIN.time2fest.com']],
    ['move-domain time2fest.com', ['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-production']],
  ];

  it.each(cases)('%s with no flag → 2, 0 calls', async (_name, argv) => {
    const r = await runMain(argv);
    expect(r.code).toBe(2);
    expect(r.calls).toBe(0);
    expect(r.text).toContain('--allow-main-domain');
  });

  it.each(cases)('%s with only --allow-main-domain → 2, 0 calls', async (_name, argv) => {
    const r = await runMain([...argv, '--allow-main-domain']);
    expect(r.code).toBe(2);
    expect(r.calls).toBe(0);
  });

  it.each(cases)('%s with only --confirm → 2, 0 calls', async (_name, argv) => {
    const env = argv.includes('--env') ? argv[argv.indexOf('--env') + 1] : 'production';
    const r = await runMain([...argv, '--confirm', env]);
    expect(r.code).toBe(2);
    expect(r.calls).toBe(0);
  });

  it('a --confirm naming another env does not count', async () => {
    const r = await runMain(['deploy', '--env', 'production', '--confirm', 'prelaunch', '--allow-main-domain']);
    expect(r.code).toBe(2);
  });

  it('move-domain to a main host needs a main-domain env in --confirm', async () => {
    const argv = ['move-domain', '--name', 'time2fest.com', '--to', 't2f-edge-production', '--allow-main-domain'];
    expect((await runMain([...argv, '--confirm', 'rehearsal'])).code).toBe(2);
    expect((await runMain([...argv, '--confirm', 'production'])).code).not.toBe(2);
  });

  it('both flags pass the guard (then `not implemented`, 0 calls)', async () => {
    const r = await runMain(['deploy', '--env', 'prelaunch', '--confirm', 'prelaunch', '--allow-main-domain']);
    expect(r.code).toBe(1);
    expect(r.text).toContain('not implemented');
    expect(r.calls).toBe(0);
  });

  it('rehearsal to its own node needs neither flag', async () => {
    expect((await runMain(['deploy', '--env', 'rehearsal', '--target', 'local'])).code).toBe(1);
  });
});

describe('178.20.157.85 is refused whatever the flags (AC-22)', () => {
  /** @type {string[][]} */
  const cases = [
    ['deploy', '--env', 'rehearsal', '--target', '178.20.157.85'],
    ['deploy', '--env', 'production', '--target', '178.20.157.85', '--confirm', 'production', '--allow-main-domain', '--emergency'],
    ['rollback', '--env', 'production', '--target', '178.20.157.85', '--confirm', 'production', '--allow-main-domain'],
    ['bootstrap', '--host', '178.20.157.85'],
    ['edge-secret', '--env', 'rehearsal', '--rotate', '--target', '178.20.157.85'],
  ];
  it.each(cases)('%j → 2, 0 calls', async (...argv) => {
    const r = await runMain(argv);
    expect(r.code).toBe(2);
    expect(r.calls).toBe(0);
    expect(r.text).toContain('178.20.157.85');
  });
});

describe('production freeze 31.12 08:00 – 01.01 14:00 UTC (AC-23)', () => {
  const both = ['--confirm', 'production', '--allow-main-domain'];

  it.each([
    ['2026-12-31T08:00:00Z'],
    ['2026-12-31T23:59:59Z'],
    ['2027-01-01T00:00:00Z'],
    ['2027-01-01T13:59:59Z'],
  ])('deploy and rollback at %s → 2, 0 calls', async (at) => {
    for (const sub of ['deploy', 'rollback']) {
      const r = await runMain([sub, '--env', 'production', ...both], new Date(at));
      expect(r.code).toBe(2);
      expect(r.calls).toBe(0);
      expect(r.text).toContain('--emergency');
    }
  });

  it.each([['2027-01-01T14:00:00Z'], ['2026-12-31T07:59:59Z'], ['2026-12-30T12:00:00Z']])('deploy at %s → allowed', async (at) => {
    const r = await runMain(['deploy', '--env', 'production', ...both], new Date(at));
    expect(r.code).toBe(1);
    expect(r.text).toContain('not implemented');
  });

  it('--emergency → allowed inside the window', async () => {
    for (const sub of ['deploy', 'rollback']) {
      const r = await runMain([sub, '--env', 'production', ...both, '--emergency'], new Date('2026-12-31T23:00:00Z'));
      expect(r.code).toBe(1);
    }
  });

  it('rehearsal is never frozen', async () => {
    const r = await runMain(['deploy', '--env', 'rehearsal'], new Date('2026-12-31T23:00:00Z'));
    expect(r.code).toBe(1);
  });

  it('inFreezeWindow edges', () => {
    expect(inFreezeWindow(new Date('2030-12-31T08:00:00Z'))).toBe(true);
    expect(inFreezeWindow(new Date('2031-01-01T13:59:59.999Z'))).toBe(true);
    expect(inFreezeWindow(new Date('2031-01-01T14:00:00Z'))).toBe(false);
    expect(inFreezeWindow(new Date('2030-12-31T07:59:59.999Z'))).toBe(false);
  });
});

describe('guardRun directly', () => {
  it('refuses an unknown env (deny by default)', () => {
    const r = guardRun({ sub: 'deploy', env: 'staging', flags: {}, now: CALM });
    expect(r.ok).toBe(false);
  });
  it('normalizes host case and a trailing dot', () => {
    expect(guardRun({ sub: 'deploy', env: 'rehearsal', target: 'WWW.time2fest.com.', flags: {}, now: CALM }).ok).toBe(false);
    expect(guardRun({ sub: 'deploy', env: 'rehearsal', target: '178.20.157.85.', flags: {}, now: CALM }).ok).toBe(false);
  });
});
