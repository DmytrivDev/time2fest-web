// @ts-check
// AC-10 (нічого в рядку оболонки), NFR-4 (секрет не потрапляє у вивід): запуск, транспорти, лапки, маскування.
import { describe, expect, it, vi } from 'vitest';
import { ExecRefusal, localTransport, run, shq, sshBaseArgs, sshTransport } from '../lib/exec.mjs';
import { createOutput, createRedactor } from '../lib/redact.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

/**
 * Розбір рядка, як його розбирає POSIX sh, для того, що дає `shq`: '…' — дослівно, \x поза лапками — x, пробіл ділить.
 * @param {string} line
 */
function shSplit(line) {
  /** @type {string[]} */
  const words = [];
  let cur = '';
  let inWord = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === "'") {
      const end = line.indexOf("'", i + 1);
      if (end < 0) throw new Error('unterminated quote');
      cur += line.slice(i + 1, end);
      i = end;
      inWord = true;
    } else if (c === '\\') {
      cur += line[++i];
      inWord = true;
    } else if (c === ' ') {
      if (inWord) words.push(cur);
      cur = '';
      inWord = false;
    } else if (/[A-Za-z0-9_./-]/.test(c)) {
      cur += c;
      inWord = true;
    } else {
      throw new Error(`unquoted shell metacharacter ${JSON.stringify(c)}`);
    }
  }
  if (inWord) words.push(cur);
  return words;
}

const SSH = { host: '203.0.113.10', user: 'deploy', knownHostsFile: 'C:\\t2f\\known_hosts' };

describe('shq', () => {
  it.each([["a'b"], ['$(x)'], ['with space'], ['`id`; rm -rf / && echo |x'], [''], ["''"], ['\\n']])('round-trips %j', (s) => {
    expect(shSplit(shq(s))).toEqual([s]);
  });

  it('a whole argv round-trips through the remote command line', async () => {
    /** @type {string[][]} */
    const spawned = [];
    const t = sshTransport(SSH, async (file, args) => {
      spawned.push([file, ...args]);
      return { code: 0, stdout: '', stderr: '' };
    });
    const argv = ['echo', "a'b", '$(x)', 'with space'];
    await t.exec(argv, { allow: ['echo', "a'b", '$(x)', 'with space'] });
    const remote = /** @type {string} */ (spawned[0].at(-1));
    expect(shSplit(remote)).toEqual(argv);
  });
});

describe('ssh transport', () => {
  it('builds the pinned-host-key ssh line with `--` before the remote command', () => {
    expect(sshBaseArgs({ ...SSH, keyFile: 'C:\\t2f\\id_ed25519' })).toEqual([
      '-o', 'BatchMode=yes',
      '-o', 'StrictHostKeyChecking=yes',
      '-o', 'UserKnownHostsFile=C:/t2f/known_hosts',
      '-o', 'ConnectTimeout=15',
      '-o', 'ServerAliveInterval=15',
      '-o', 'ServerAliveCountMax=4',
      '-i', 'C:/t2f/id_ed25519',
      'deploy@203.0.113.10', '--',
    ]);
    expect(sshBaseArgs({ ...SSH, accept: 'new' })).toContain('StrictHostKeyChecking=accept-new');
  });

  it.each([
    [{ ...SSH, host: '178.20.157.85' }],
    [{ ...SSH, host: '-oProxyCommand=x' }],
    [{ ...SSH, host: 'a b' }],
    [{ ...SSH, user: 'root;id' }],
    [{ ...SSH, knownHostsFile: 'C:\\Program Files\\kh' }],
    [{ ...SSH, knownHostsFile: '%d/kh' }],
    [{ ...SSH, keyFile: '-oX' }],
  ])('refuses %j before any spawn', (o) => {
    const runner = vi.fn();
    expect(() => sshTransport(o, runner)).toThrow(ExecRefusal);
    expect(runner).not.toHaveBeenCalled();
  });

  it('an element with \\n or NUL throws and spawns nothing', () => {
    const runner = vi.fn();
    const t = sshTransport(SSH, runner);
    expect(() => t.exec(['docker', 'ps\nid'], { allow: [/^[\s\S]*$/] })).toThrow(ExecRefusal);
    expect(() => t.exec(['docker', 'ps\0'], { allow: [/^[\s\S]*$/] })).toThrow(ExecRefusal);
    expect(runner).not.toHaveBeenCalled();
  });

  it('the default allow-list refuses shell metacharacters; a per-call list narrows further', () => {
    const runner = vi.fn(async () => ({ code: 0, stdout: '', stderr: '' }));
    const t = sshTransport(SSH, runner);
    for (const bad of ['$(id)', 'a;b', 'a b', '`id`', 'a|b', "a'b", 'a&b', '*']) {
      expect(() => t.exec(['echo', bad])).toThrow(ExecRefusal);
    }
    expect(() => t.exec(['docker', 'image', 'rm', 't2f-server:latest'], { allow: ['docker', 'image', 'rm', /^t2f-server:[0-9a-f]{40}$/] })).toThrow(
      ExecRefusal,
    );
    expect(runner).not.toHaveBeenCalled();
  });
});

describe('run and the local transport', () => {
  it('the local transport runs `node -e` and returns its code', async () => {
    const r = await localTransport().exec([process.execPath, '-e', 'process.stdout.write("hi\\n"); process.exit(7)']);
    expect(r.code).toBe(7);
    expect(r.stdout.trim()).toBe('hi');
  });

  it('an argument with a newline throws and spawns nothing', () => {
    expect(() => run(process.execPath, ['-e', '1\n2'])).toThrow(ExecRefusal);
    expect(() => localTransport().exec([process.execPath, '-e\0'])).toThrow(ExecRefusal);
  });

  it('never spawns a .cmd / .bat shim', () => {
    expect(() => run('wrangler.cmd', ['--version'])).toThrow(ExecRefusal);
    expect(() => run('C:\\x\\build.BAT', [])).toThrow(ExecRefusal);
  });

  it('metacharacters stay literal arguments (shell:false)', async () => {
    const r = await run(process.execPath, ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(1)))', '$(id)', 'a;b', '`x` | y']);
    expect(JSON.parse(r.stdout)).toEqual(['$(id)', 'a;b', '`x` | y']);
  });

  it('passes string input on stdin and splits lines on \\r?\\n', async () => {
    /** @type {string[]} */
    const lines = [];
    const r = await run(process.execPath, ['-e', 'process.stdin.pipe(process.stdout); process.stderr.write("e1\\r\\ne2")'], {
      input: 'l1\r\nl2\nl3',
      onLine: (s, l) => lines.push(`${s}:${l}`),
    });
    expect(r.code).toBe(0);
    expect(lines.filter((l) => l.startsWith('stdout:'))).toEqual(['stdout:l1', 'stdout:l2', 'stdout:l3']);
    expect(lines.filter((l) => l.startsWith('stderr:'))).toEqual(['stderr:e1', 'stderr:e2']);
  });

  it('a missing executable resolves with code 127', async () => {
    const r = await run('t2f-no-such-binary-xyz', []);
    expect(r.code).toBe(127);
  });

  it('timeoutMs kills the child and reports a timeout', async () => {
    const r = await run(process.execPath, ['-e', 'setTimeout(() => {}, 60000)'], { timeoutMs: 200 });
    expect(r.timedOut).toBe(true);
    expect(r.code).toBe(124);
  });
});

describe('redaction (NFR-4)', () => {
  const SENTINEL = 'S3NT1NEL-edge-secret-value-0123456789'; // check-secrets: allow

  it('a sentinel secret in child stdout/stderr is masked in out', async () => {
    const redactor = createRedactor([SENTINEL]);
    /** @type {string[]} */
    const written = [];
    const { out, err } = createOutput(redactor, (l) => written.push(`out:${l}`), (l) => written.push(`err:${l}`));
    const b64 = Buffer.from(SENTINEL).toString('base64url');
    const hex = Buffer.from(SENTINEL).toString('hex');
    await run(
      process.execPath,
      ['-e', 'const [s,b,h]=process.argv.slice(1); console.log("token=" + s); console.error("b64 " + b + " hex " + h.toUpperCase())', SENTINEL, b64, hex],
      { onLine: (s, l) => (s === 'stdout' ? out(l) : err(l)) },
    );
    const all = written.join('\n');
    expect(written.length).toBeGreaterThanOrEqual(2);
    expect(all).toContain('token=***');
    expect(all).not.toContain(SENTINEL);
    expect(all).not.toContain(b64);
    expect(all).not.toContain(hex.toUpperCase());
  });

  it('values shorter than 8 characters are not registered; add() registers later secrets', () => {
    const r = createRedactor(['short', undefined, null]);
    expect(r.mask('a short line')).toBe('a short line');
    r.add(SENTINEL);
    expect(r.mask(`x ${SENTINEL} y`)).toBe('x *** y');
    expect(r.contains(`x ${Buffer.from(SENTINEL).toString('base64')}`)).toBe(true);
  });

  it('main masks secrets from SECRET_ENV_NAMES in its own output', async () => {
    const { main } = await import('../ops.mjs');
    /** @type {string[]} */
    const lines = [];
    await main(['deploy', '--env', SENTINEL], { env: { T2F_EDGE_SECRET: SENTINEL }, out: (l) => lines.push(l), err: (l) => lines.push(l) });
    expect(lines.join('\n')).not.toContain(SENTINEL);
  });
});

describe('fakeExec', () => {
  it('records transport, argv and input length — never the input bytes', async () => {
    const fake = createFakeExec([{ match: ['docker', 'load'], result: { code: 0, stdout: 'Loaded image\n' } }]);
    const t = fake.sshTransport(SSH);
    const r = await t.exec(['docker', 'load'], { input: 'secret-bytes-here' });
    expect(r.stdout).toBe('Loaded image\n');
    expect(fake.calls).toEqual([{ transport: 'ssh:203.0.113.10', argv: ['docker', 'load'], inputLength: 17 }]);
    expect(JSON.stringify(fake.calls)).not.toContain('secret-bytes-here');
  });

  it('applies the same refusals as the real transports', () => {
    const fake = createFakeExec();
    expect(() => fake.sshTransport(SSH).exec(['echo', '$(id)'])).toThrow(ExecRefusal);
    expect(() => fake.localTransport().exec(['echo', 'a\nb'])).toThrow(ExecRefusal);
    expect(() => fake.sshTransport({ ...SSH, host: '178.20.157.85' })).toThrow(ExecRefusal);
    expect(fake.calls).toHaveLength(0);
  });
});
