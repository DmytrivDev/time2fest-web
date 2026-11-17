// @ts-check
// W24 — підготовка вузла на підставному транспорті (AC-8, EC-9): кроки й порядок, крок 6 лише після перевірки
// входу deploy (крок 5), повторний запуск без змін, повторний запуск після вимкнення root — шлях deploy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { DEPLOY_CHECKS, ROOT_ONLY_NOTE, ROOT_STEPS, SSHD_CONF, ufwOk } from '../lib/bootstrap.mjs';
import { assertAllowed, assertArgv, DEFAULT_REMOTE_ALLOW } from '../lib/exec.mjs';
import { createFakeExec } from './support/fakeExec.mjs';

const HOST = '203.0.113.20';
const NODE_DIR = '/srv/t2f/rehearsal';
const FINGERPRINT = '256 SHA256:Zm9vYmFyYmF6cXV4MDEyMzQ1Njc4OWFiY2RlZg 203.0.113.20 (ED25519)';
const UFW_ACTIVE = [
  'Status: active',
  'Logging: on (low)',
  'Default: deny (incoming), allow (outgoing), disabled (routed)',
  'New profiles: skip',
  '',
  'To                         Action      From',
  '--                         ------      ----',
  '22/tcp                     ALLOW IN    Anywhere',
  '22/tcp (v6)                ALLOW IN    Anywhere (v6)',
  '',
].join('\n');
/** Прапорець стану вузла для кожного кроку. */
const FLAG = /** @type {Record<string, 'user' | 'docker' | 'dir' | 'ufw' | 'sshd'>} */ ({
  'deploy-user': 'user',
  docker: 'docker',
  'node-dir': 'dir',
  firewall: 'ufw',
  sshd: 'sshd',
});

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/** @param {string[]} a @param {string[]} b */
const same = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

/**
 * Підставний вузол: стан, виклики `{ user, kind, step }`, транспорти від імені користувача.
 * @param {Partial<{ user: boolean, docker: boolean, dir: boolean, ufw: boolean, sshd: boolean, rootRefused: boolean, deployLogin: boolean }>} [o]
 */
function fakeNode(o = {}) {
  const st = { user: false, docker: false, dir: false, ufw: false, sshd: false, rootRefused: false, deployLogin: true, ...o };
  /** @type {{ user: string, kind: string, step: string, inputLength: number }[]} */
  const calls = [];
  /** @param {string} user @param {string[]} argv @returns {{ kind: string, step: string, code: number, stdout?: string }} */
  const handle = (user, argv) => {
    if (same(argv, ['true'])) {
      if (user === 'root') return { kind: 'login', step: 'root', code: st.rootRefused ? 255 : 0 };
      return { kind: 'login', step: 'deploy', code: st.user && st.deployLogin ? 0 : 255 };
    }
    if (user === 'root') {
      for (const s of ROOT_STEPS) {
        const flag = FLAG[s.id];
        if (same(argv, s.check(NODE_DIR))) {
          if (s.id === 'firewall') return { kind: 'check', step: s.id, code: 0, stdout: st.ufw ? UFW_ACTIVE : 'Status: inactive\n' };
          return { kind: 'check', step: s.id, code: st[flag] ? 0 : 1 };
        }
        if (s.apply && same(argv, s.apply(NODE_DIR))) {
          st[flag] = true;
          if (s.id === 'sshd') st.rootRefused = true;
          return { kind: 'apply', step: s.id, code: 0 };
        }
      }
    } else {
      for (const s of DEPLOY_CHECKS) {
        if (same(argv, s.check(NODE_DIR))) return { kind: 'check', step: `deploy:${s.id}`, code: st[FLAG[s.id]] ? 0 : 1 };
      }
    }
    return { kind: 'unknown', step: argv.join(' '), code: 99 };
  };
  /** @param {string} user @returns {import('../lib/exec.mjs').Transport} */
  const sshAs = (user) => ({
    kind: 'ssh',
    describe: `${user}@${HOST}`,
    async exec(argv, opts = {}) {
      assertArgv(argv);
      assertAllowed(argv, opts.allow ?? DEFAULT_REMOTE_ALLOW);
      const r = handle(user, argv);
      const inputLength = typeof opts.input === 'string' ? Buffer.byteLength(opts.input) : 0;
      calls.push({ user, kind: r.kind, step: r.step, inputLength });
      return { code: r.code, stdout: r.stdout ?? '', stderr: '' };
    },
  });

  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-p8-boot-'));
  cleanups.push(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
  const fx = createFakeExec([{ match: ['ssh-keygen'], result: { stdout: `# Host ${HOST} found: line 1\n${FINGERPRINT}\n` } }]);
  /** @type {string[]} */
  const out = [];
  /** @type {string[]} */
  const err = [];
  const deps = {
    out: (/** @type {string} */ l) => out.push(l),
    err: (/** @type {string} */ l) => err.push(l),
    env: {},
    exec: fx,
    stateRoot,
    sshAs,
  };
  return { st, calls, fx, out, err, deps, stateRoot };
}

/** @param {ReturnType<typeof fakeNode>} n */
const applied = (n) => n.calls.filter((c) => c.kind === 'apply').map((c) => c.step);
const BOOT = ['bootstrap', '--host', HOST];

describe('ops bootstrap', () => {
  it('prepares a fresh node in order: user, Docker, dir, firewall, deploy login, sshd', async () => {
    const n = fakeNode();
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual(['deploy-user', 'docker', 'node-dir', 'firewall', 'sshd']);

    // Крок 5 (вхід deploy) — після брандмауера і до будь-якого виклику кроку sshd.
    const seq = n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`);
    const login = seq.indexOf('deploy:login:deploy');
    expect(login).toBeGreaterThan(seq.indexOf('root:apply:firewall'));
    expect(login).toBeLessThan(seq.indexOf('root:check:sshd'));
    // Перший виклик — вхід root; drop-in sshd — зі stdin.
    expect(seq[0]).toBe('root:login:root');
    expect(n.calls.find((c) => c.kind === 'apply' && c.step === 'sshd')?.inputLength).toBe(Buffer.byteLength(SSHD_CONF));

    const text = n.out.join('\n');
    expect(text).toContain(FINGERPRINT);
    expect(text).toContain('bootstrap: 6 sshd — зроблено');
    expect(text).toContain('bootstrap: готово');
    expect(n.fx.calls[0].argv).toEqual(['ssh-keygen', '-l', '-F', HOST, '-f', path.join(n.stateRoot, 'known_hosts')]);
  });

  it('never runs step 6 when the deploy login check fails', async () => {
    const n = fakeNode({ deployLogin: false });
    expect(await main(BOOT, n.deps)).toBe(1);
    expect(applied(n)).toEqual(['deploy-user', 'docker', 'node-dir', 'firewall']);
    expect(n.calls.some((c) => c.step === 'sshd')).toBe(false);
    expect(n.st.sshd).toBe(false);
    expect(n.err.join('\n')).toContain('вхід root НЕ вимкнено');
  });

  it('with every check already passing makes 0 mutating calls and reports `без змін`', async () => {
    const n = fakeNode({ user: true, docker: true, dir: true, ufw: true, sshd: true });
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual([]);
    expect(n.out.join('\n')).toContain('bootstrap: без змін');
  });

  it('when root is refused on rerun, checks as deploy only and reports `без змін`', async () => {
    const n = fakeNode({ user: true, docker: true, dir: true, ufw: true, sshd: true, rootRefused: true });
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual([]);
    expect(n.calls.filter((c) => c.user === 'root').map((c) => c.kind)).toEqual(['login']);
    expect(n.calls.filter((c) => c.user === 'deploy' && c.kind === 'check').map((c) => c.step)).toEqual(['deploy:docker', 'deploy:node-dir']);
    const text = n.out.join('\n');
    expect(text).toContain(ROOT_ONLY_NOTE);
    expect(text).toContain('bootstrap: без змін');
  });

  it('a second run after a full bootstrap changes nothing', async () => {
    const n = fakeNode();
    expect(await main(BOOT, n.deps)).toBe(0);
    n.calls.length = 0;
    n.out.length = 0;
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual([]);
    expect(n.out.join('\n')).toContain('bootstrap: без змін');
  });

  it('returns 1 when neither root nor deploy can log in', async () => {
    const n = fakeNode({ rootRefused: true });
    expect(await main(BOOT, n.deps)).toBe(1);
    expect(applied(n)).toEqual([]);
  });

  it('refuses the old production server and a non-rehearsal env with 2 before any call', async () => {
    const n = fakeNode();
    expect(await main(['bootstrap', '--host', '178.20.157.85'], n.deps)).toBe(2);
    expect(await main([...BOOT, '--env', 'production'], n.deps)).toBe(2);
    expect(n.calls).toEqual([]);
  });

  it('first contact goes as root and as deploy with accept-new into .local/known_hosts', async () => {
    const n = fakeNode();
    /** @type {import('../lib/exec.mjs').SshOpts[]} */
    const opened = [];
    const exec = {
      ...n.fx,
      /** @param {import('../lib/exec.mjs').SshOpts} o */
      sshTransport: (o) => {
        opened.push(o);
        return n.fx.sshTransport(o);
      },
    };
    const { sshAs: _s, ...deps } = n.deps;
    await main(BOOT, { ...deps, exec });
    expect(opened.map((o) => [o.user, o.accept, o.knownHostsFile])).toEqual([
      ['root', 'new', path.join(n.stateRoot, 'known_hosts')],
      ['deploy', 'new', path.join(n.stateRoot, 'known_hosts')],
    ]);
  });
});

describe('ufwOk', () => {
  it('accepts only an active default-deny firewall with 22/tcp as the single inbound rule', () => {
    expect(ufwOk(UFW_ACTIVE)).toBe(true);
    expect(ufwOk(UFW_ACTIVE.replace('Status: active', 'Status: inactive'))).toBe(false);
    expect(ufwOk(UFW_ACTIVE.replace('deny (incoming)', 'allow (incoming)'))).toBe(false);
    expect(ufwOk(`${UFW_ACTIVE}80/tcp                     ALLOW IN    Anywhere\n`)).toBe(false);
  });
});
