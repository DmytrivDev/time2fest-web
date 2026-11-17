// @ts-check
// AC-10: недопустимий аргумент → код 2 до будь-якої дії; жоден аргумент не потрапляє в рядок оболонки.
import { describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { isHostName, parseArgs } from '../lib/args.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const SHA = 'a'.repeat(40);

/** @param {string[]} argv */
async function runMain(argv) {
  const fake = createFakeExec();
  /** @type {string[]} */
  const lines = [];
  const code = await main(argv, { exec: fake, out: (l) => lines.push(l), err: (l) => lines.push(l), env: {}, ...FAKE_TARGET });
  return { code, calls: fake.calls, text: lines.join('\n') };
}

describe('ops main: refused arguments (AC-10)', () => {
  const injected = [
    ['--target', 'host;id'],
    ['--target', '$(id)'],
    ['--target', 'a b'],
    ['--target', 'a`id`'],
    ['--target', 'host\nid'],
    ['--commit', 'abc1234;id'],
    ['--commit', '$(id)'],
    ['--commit', 'abc 1234'],
    ['--commit', '`id`abc12'],
    ['--commit', 'abc1234\n'],
    ['--env', 'rehearsal;id'],
    ['--env', 'rehearsal\n'],
  ];

  it.each(injected)('deploy %s %j → 2 and 0 executor calls', async (flag, value) => {
    const argv = flag === '--env' ? ['deploy', '--env', value] : ['deploy', '--env', 'rehearsal', flag, value];
    const r = await runMain(argv);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.text).toContain(flag);
  });

  it('an unknown env → 2, names --env, 0 calls', async () => {
    const r = await runMain(['deploy', '--env', 'staging']);
    expect(r.code).toBe(2);
    expect(r.calls).toHaveLength(0);
    expect(r.text).toContain('--env');
  });

  it('a value with a newline is never echoed back', async () => {
    const r = await runMain(['deploy', '--env', 'rehearsal', '--target', 'evil\nINJECTED']);
    expect(r.code).toBe(2);
    expect(r.text).not.toContain('INJECTED');
  });

  it('rollback --to that is not 40 hex → 2', async () => {
    for (const to of ['abc1234', `${SHA};id`, SHA.toUpperCase()]) {
      expect((await runMain(['rollback', '--env', 'rehearsal', '--to', to])).code).toBe(2);
    }
  });

  it('unknown flag, duplicate flag, missing value, stray positional → 2', async () => {
    expect((await runMain(['deploy', '--env', 'rehearsal', '--force'])).code).toBe(2);
    expect((await runMain(['deploy', '--env', 'rehearsal', '--env', 'rehearsal'])).code).toBe(2);
    expect((await runMain(['deploy', '--env', 'rehearsal', '--probe', '--probe'])).code).toBe(2);
    expect((await runMain(['deploy', '--env', 'rehearsal', '--target'])).code).toBe(2);
    expect((await runMain(['deploy', '--env', 'rehearsal', 'extra'])).code).toBe(2);
    expect((await runMain(['deploy'])).code).toBe(2);
  });

  it('a valid rehearsal deploy passes arguments and the guard (then the runner checks git: the fake knows no commit)', async () => {
    const r = await runMain(['deploy', '--env', 'rehearsal', '--target', '203.0.113.10', '--commit', 'abc1234', '--probe']);
    expect(r.code).toBe(2);
    expect(r.text).toContain('--commit: abc1234 не є комітом');
    // Лише перевірки git до будь-якої зміни: ні ssh, ні docker, ні wrangler.
    expect(r.calls.map((c) => c.argv[0])).toEqual(['git', 'git']);
  });
});

describe('parseArgs', () => {
  it('parses a full deploy line', () => {
    const r = parseArgs('deploy', ['--', '--env', 'rehearsal', '--target', 'Node-1.Example.org', '--commit', SHA, '--secrets-file', 'C:\\keys\\a b.env']);
    expect(r).toEqual({
      ok: true,
      args: {
        sub: 'deploy',
        env: 'rehearsal',
        values: { target: 'node-1.example.org', commit: SHA, 'secrets-file': 'C:\\keys\\a b.env' },
        flags: {},
      },
    });
  });

  it('allowed envs depend on the subcommand', () => {
    expect(parseArgs('edge-secret', ['--env', 'production', '--generate']).ok).toBe(false);
    expect(parseArgs('bootstrap', ['--host', '203.0.113.10', '--env', 'prelaunch']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'prelaunch', 'plan']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'plan']).ok).toBe(true);
    expect(parseArgs('deploy', ['--env', 'prelaunch']).ok).toBe(true);
  });

  it('--confirm must be an env; --size matches its pattern', () => {
    expect(parseArgs('deploy', ['--env', 'rehearsal', '--confirm', 'prod']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'night', '--size', 's-2vcpu-4gb']).ok).toBe(true);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'night', '--size', 'S_2;x']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'night', '--size', 'a'.repeat(41)]).ok).toBe(false);
  });

  it('capacity requires one known action', () => {
    expect(parseArgs('capacity', ['--env', 'rehearsal']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'explode']).ok).toBe(false);
    expect(parseArgs('capacity', ['--env', 'rehearsal', 'plan', 'status']).ok).toBe(false);
  });

  it('edge-secret takes exactly one of --generate / --rotate', () => {
    expect(parseArgs('edge-secret', ['--env', 'rehearsal']).ok).toBe(false);
    expect(parseArgs('edge-secret', ['--env', 'rehearsal', '--generate', '--rotate']).ok).toBe(false);
    expect(parseArgs('edge-secret', ['--env', 'rehearsal', '--rotate', '--target', 'local']).ok).toBe(true);
  });

  it('move-domain has no --env and validates --name / --to', () => {
    expect(parseArgs('move-domain', ['--name', 'rehearsal.time2fest.com', '--to', 't2f-edge-rehearsal-alt']).ok).toBe(true);
    expect(parseArgs('move-domain', ['--env', 'rehearsal', '--name', 'rehearsal.time2fest.com', '--to', 'x']).ok).toBe(false);
    expect(parseArgs('move-domain', ['--name', 'rehearsal.time2fest.com', '--to', 'T2F;x']).ok).toBe(false);
    expect(parseArgs('move-domain', ['--name', 'rehearsal.time2fest.com']).ok).toBe(false);
  });

  it('every refusal carries code 2', () => {
    const r = parseArgs('deploy', ['--nope']);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe(2);
  });
});

describe('isHostName (RFC 1123)', () => {
  it.each(['rehearsal.time2fest.com', 'node-1', 'a.b.c', `${'a'.repeat(63)}.com`])('accepts %s', (h) => {
    expect(isHostName(h)).toBe(true);
  });
  it.each(['-a.com', 'a-.com', 'a..b', 'a_b.com', '999.1.1.1', '2991889749', `${'a'.repeat(64)}.com`, `${'a.'.repeat(127)}com`, ''])(
    'refuses %j',
    (h) => {
      expect(isHostName(h)).toBe(false);
    },
  );
});
