// @ts-check
// O·P16: `ops clock` на підставному вузлі — точний argv кожної дії, відмова production до будь-якого з’єднання (AC-54, AC-55).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { clockCliArgs } from '../lib/clock.mjs';
import { main } from '../ops.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const HOST = '203.0.113.10';
const PREFIX = ['docker', 'compose', '-p', 't2f-rehearsal', '-f', '/srv/t2f/rehearsal/compose.yml', '--env-file', '/srv/t2f/rehearsal/current.env', 'exec', '-T', 'server', 'pnpm', 'run', 'clock'];
const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {{ code?: number, stdout?: string }} [o] */
function setup(o = {}) {
  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-clock-'));
  cleanups.push(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  /** @type {string[][]} */
  const sent = [];
  let transports = 0;
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const deps = {
    out: (/** @type {string} */ l) => out.push(l),
    err: (/** @type {string} */ l) => err.push(l),
    env: {},
    exec: /** @type {any} */ ({}),
    paths: { stateRoot },
    ...FAKE_TARGET,
    transport: () => {
      transports += 1;
      return {
        kind: /** @type {const} */ ('ssh'),
        describe: `ssh:${HOST}`,
        async exec(/** @type {string[]} */ argv) {
          sent.push(argv);
          return { code: o.code ?? 0, stdout: o.stdout ?? 'pnpm banner\n{"ok":true}\n', stderr: o.code ? 'boom' : '' };
        },
      };
    },
  };
  return { deps, sent, out, err, stateRoot, transports: () => transports };
}
const run = (/** @type {string[]} */ a) => ['clock', ...a, '--env', 'rehearsal', '--target', HOST];

describe('ops clock', () => {
  it.each([
    [['status'], ['status']],
    [['set', '--at', '2026-12-31T23:59:50Z'], ['set', '--at', '2026-12-31T23:59:50Z']],
    [['real'], ['real']],
    [['restart-night'], ['restart-night']],
    [['speed', '--speed', '60'], ['speed', '60']],
    [['records'], ['records']],
    [['records', '--epoch', '3'], ['records', '--epoch', '3']],
  ])('%j sends exactly one compose exec with %j and prints the JSON line', async (cli, tail) => {
    const s = setup();
    expect(await main(run(cli), s.deps)).toBe(0);
    expect(s.sent).toEqual([[...PREFIX, ...tail]]);
    expect(s.out).toEqual(['{"ok":true}']);
  });

  it('journals every change with actor ops; reads are not journaled', async () => {
    const s = setup();
    await main(run(['speed', '--speed', '600']), s.deps);
    await main(run(['status']), s.deps);
    const lines = fs.readFileSync(path.join(s.stateRoot, 'rehearsal', 'server2.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ sub: 'clock', actor: 'ops', action: 'speed', result: 'ok', args: ['speed', '600'] });
  });

  it('--env production and prelaunch: code 2, no transport created, nothing sent (AC-55)', async () => {
    for (const env of ['production', 'prelaunch']) {
      const s = setup();
      expect(await main(['clock', 'status', '--env', env, '--target', HOST], s.deps)).toBe(2);
      expect(s.transports()).toBe(0);
      expect(s.sent).toEqual([]);
    }
  });

  it('bad flag combinations and values are refused with code 2 before any connection', async () => {
    for (const bad of [
      ['set'],
      ['set', '--at', 'tomorrow'],
      ['set', '--at', '2026-12-31T23:59:50Z', '--speed', '5'],
      ['speed'],
      ['speed', '--speed', '601'],
      ['status', '--epoch', '1'],
      ['nuke'],
    ]) {
      const s = setup();
      expect(await main(run(bad), s.deps), bad.join(' ')).toBe(2);
      expect(s.transports()).toBe(0);
    }
  });

  it('server refusal (exit 2) maps to 2, other failures to 1; both report stderr', async () => {
    const refused = setup({ code: 2 });
    expect(await main(run(['real']), refused.deps)).toBe(2);
    const failed = setup({ code: 1 });
    expect(await main(run(['real']), failed.deps)).toBe(1);
    expect(failed.err.join('\n')).toContain('boom');
  });

  it('clockCliArgs is pure', () => {
    expect(clockCliArgs('speed', { speed: '0' })).toEqual({ argv: ['speed', '0'] });
    expect(clockCliArgs('real', { at: 'x' })).toEqual({ message: '--at: не для дії real' });
  });
});
