// @ts-check
// W24 — підготовка вузла на підставному транспорті (AC-8, EC-9): кроки й порядок, крок 7 (sshd) лише після перевірки
// входу deploy (крок 6), повторний запуск без змін, повторний запуск після вимкнення root — шлях deploy.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { main } from '../ops.mjs';
import { DEPLOY_CHECKS, ROOT_ONLY_NOTE, ROOT_STEPS, SSHD_CONF, SWAP_SYSCTL, ufwOk } from '../lib/bootstrap.mjs';
import { assertAllowed, assertArgv, DEFAULT_REMOTE_ALLOW, sshTransport } from '../lib/exec.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

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
const FLAG = /** @type {Record<string, 'user' | 'docker' | 'dir' | 'ufw' | 'swap' | 'sshd'>} */ ({
  'deploy-user': 'user',
  docker: 'docker',
  'node-dir': 'dir',
  firewall: 'ufw',
  swap: 'swap',
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
 * @param {Partial<{ user: boolean, docker: boolean, dir: boolean, ufw: boolean, swap: boolean, sshd: boolean, rootRefused: boolean, deployLogin: boolean, sshdVerifyFails: boolean, dropIn: boolean }>} [o]
 */
function fakeNode(o = {}) {
  const st = { user: false, docker: false, dir: false, ufw: false, swap: false, sshd: false, rootRefused: false, deployLogin: true, sshdVerifyFails: false, dropIn: false, ...o };
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
          if (s.id === 'sshd') {
            st.dropIn = true;
            // Перевірка в тому самому з’єднанні не збіглася: скрипт знімає drop-in й виходить із кодом 1.
            if (st.sshdVerifyFails) {
              st.dropIn = false;
              return { kind: 'apply', step: s.id, code: 1 };
            }
          }
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
  /** @param {{ user: string }} o @returns {import('../lib/exec.mjs').Transport} */
  const sshAs = ({ user }) => ({
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
    paths: { stateRoot },
    sshAs,
    ...FAKE_TARGET,
  };
  return { st, calls, fx, out, err, deps, stateRoot };
}

/** @param {ReturnType<typeof fakeNode>} n */
const applied = (n) => n.calls.filter((c) => c.kind === 'apply').map((c) => c.step);
const BOOT = ['bootstrap', '--host', HOST];

describe('ops bootstrap', () => {
  it('prepares a fresh node in order: user, Docker, dir, firewall, swap, deploy login, sshd', async () => {
    const n = fakeNode();
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual(['deploy-user', 'docker', 'node-dir', 'firewall', 'swap', 'sshd']);

    // Крок 6 (вхід deploy) — після брандмауера й підкачки і до будь-якого виклику кроку sshd.
    expect(n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`).indexOf('deploy:login:deploy')).toBeGreaterThan(
      n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`).indexOf('root:apply:swap'),
    );
    const seq = n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`);
    const login = seq.indexOf('deploy:login:deploy');
    expect(login).toBeGreaterThan(seq.indexOf('root:apply:firewall'));
    expect(login).toBeLessThan(seq.indexOf('root:check:sshd'));
    // Перший виклик — вхід root; drop-in sshd — зі stdin.
    expect(seq[0]).toBe('root:login:root');
    expect(n.calls.find((c) => c.kind === 'apply' && c.step === 'sshd')?.inputLength).toBe(Buffer.byteLength(SSHD_CONF));

    const text = n.out.join('\n');
    expect(text).toContain(FINGERPRINT);
    expect(text).toContain('bootstrap: 5 swap — зроблено');
    expect(text).toContain('bootstrap: 6 deploy-login — вхід deploy працює');
    expect(text).toContain('bootstrap: 7 sshd — зроблено');
    expect(text).toContain('bootstrap: готово');
    expect(n.fx.calls[0].argv).toEqual(['ssh-keygen', '-l', '-F', HOST, '-f', path.join(n.stateRoot, 'known_hosts')]);
  });

  it('L2: sshd verifies itself inside the apply connection; no root connection after the sshd apply', async () => {
    const n = fakeNode();
    expect(await main(BOOT, n.deps)).toBe(0);
    const seq = n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`);
    const at = seq.indexOf('root:apply:sshd');
    expect(at).toBeGreaterThan(-1);
    expect(seq.slice(at + 1).filter((x) => x.startsWith('root:'))).toEqual([]);
    // Після sshd — лише вхід deploy, і він не перший: перевірка ззовні.
    expect(seq.slice(at + 1)).toEqual(['deploy:login:deploy']);
    expect(n.out.join('\n')).toContain('bootstrap: 7 sshd — зроблено');
    expect(n.err).toEqual([]);
    expect(n.st.dropIn).toBe(true);
    // Перевірка дійсної конфігурації стоїть у команді apply після reload.
    const apply = ROOT_STEPS.find((s) => s.id === 'sshd')?.apply?.(NODE_DIR)[2] ?? '';
    expect(apply.indexOf('systemctl reload ssh')).toBeLessThan(apply.indexOf('sshd -T'));
    for (const k of ['permitrootlogin no', 'passwordauthentication no', 'kbdinteractiveauthentication no']) expect(apply).toContain(k);
  });

  it('L2: a failing in-connection check fails the step with the real exit code and removes the drop-in', async () => {
    const n = fakeNode({ sshdVerifyFails: true });
    expect(await main(BOOT, n.deps)).toBe(1);
    expect(n.err.join('\n')).toContain('7 sshd (SSH: без входу root і паролів) не вдався (код 1)');
    expect(n.st.dropIn).toBe(false);
    expect(n.st.sshd).toBe(false);
    const seq = n.calls.map((c) => `${c.user}:${c.kind}:${c.step}`);
    expect(seq.slice(seq.indexOf('root:apply:sshd') + 1)).toEqual([]);
    const apply = ROOT_STEPS.find((s) => s.id === 'sshd')?.apply?.(NODE_DIR)[2] ?? '';
    expect(apply).toMatch(/\|\| \{ rm -f \/etc\/ssh\/sshd_config\.d\/00-t2f\.conf; systemctl reload ssh; exit 1; \}$/);
  });

  it('never runs step 7 (sshd) when the deploy login check fails', async () => {
    const n = fakeNode({ deployLogin: false });
    expect(await main(BOOT, n.deps)).toBe(1);
    expect(applied(n)).toEqual(['deploy-user', 'docker', 'node-dir', 'firewall', 'swap']);
    expect(n.calls.some((c) => c.step === 'sshd')).toBe(false);
    expect(n.st.sshd).toBe(false);
    expect(n.err.join('\n')).toContain('вхід root НЕ вимкнено');
  });

  it('with every check already passing makes 0 mutating calls and reports `без змін`', async () => {
    const n = fakeNode({ user: true, docker: true, dir: true, ufw: true, swap: true, sshd: true });
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual([]);
    expect(n.out.join('\n')).toContain('bootstrap: без змін');
  });

  it('when root is refused on rerun, checks as deploy only and reports `без змін`', async () => {
    const n = fakeNode({ user: true, docker: true, dir: true, ufw: true, swap: true, sshd: true, rootRefused: true });
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

  it('N4: a host name is resolved once — first contact goes to the checked IP with HostKeyAlias=<name>', async () => {
    const n = fakeNode();
    /** @type {import('../lib/exec.mjs').SshOpts[]} */
    const opened = [];
    /** @type {string[]} */
    const lookups = [];
    /** @type {string[][]} */
    const sshArgv = [];
    const exec = {
      ...n.fx,
      /** @param {import('../lib/exec.mjs').SshOpts} o */
      sshTransport: (o) => {
        opened.push(o);
        // Справжній транспорт на підставному виконавці: видно аргументи ssh.
        return sshTransport(o, async (_file, args) => {
          sshArgv.push(args);
          return { code: 255, stdout: '', stderr: '' };
        });
      },
    };
    const { sshAs: _s, lookupHost: _l, ...deps } = n.deps;
    // Перше розв’язання (звірка в main) і друге (bootstrap) дають різні адреси: з’єднання — лише з перевіреною в bootstrap.
    const answers = [['203.0.113.30'], ['203.0.113.31']];
    const lookupHost = async (/** @type {string} */ h) => {
      lookups.push(h);
      return answers[Math.min(lookups.length - 1, 1)];
    };
    await main(['bootstrap', '--host', 'node.example.org'], { ...deps, exec, lookupHost });
    expect(opened.map((o) => [o.user, o.host, o.hostKeyAlias])).toEqual([
      ['root', '203.0.113.31', 'node.example.org'],
      ['deploy', '203.0.113.31', 'node.example.org'],
    ]);
    expect(sshArgv[0]).toEqual(expect.arrayContaining(['HostKeyAlias=node.example.org', 'root@203.0.113.31']));
    expect(sshArgv.flat().some((a) => a.includes('node.example.org') && a.includes('@'))).toBe(false);
  });

  it('N4: a name without an IPv4 address → 2 before any ssh', async () => {
    const n = fakeNode();
    const r = await main(['bootstrap', '--host', 'v6only.example.org'], { ...n.deps, lookupHost: async () => ['2001:db8::7'] });
    expect(r).toBe(2);
    expect(n.calls).toEqual([]);
    expect(n.err.join('\n')).toContain('немає IPv4-адреси');
  });
});

describe('swap step (owner decision 2026-11-17: 1 vCPU / 2 GB node)', () => {
  const step = ROOT_STEPS.find((x) => x.id === 'swap');
  const check = step?.check(NODE_DIR)[2] ?? '';
  const apply = step?.apply?.(NODE_DIR)[2] ?? '';

  it('runs as root before the sshd step, so the realtime preparation (full step list) gets it too', () => {
    const ids = ROOT_STEPS.map((x) => x.id);
    expect(ids.indexOf('swap')).toBeGreaterThan(-1);
    expect(ids.indexOf('swap')).toBeLessThan(ids.indexOf('sshd'));
  });

  it('check-before-apply: done only when swapon lists /swapfile, fstab has it and swappiness is 10', () => {
    expect(check).toContain('swapon --show=NAME --noheadings | grep -qx /swapfile');
    expect(check).toContain('grep -q "^/swapfile " /etc/fstab');
    expect(check).toContain(`test -f ${SWAP_SYSCTL}`);
    expect(check).toContain('"$(cat /proc/sys/vm/swappiness)" = 10');
  });

  it('apply: 2 GB /swapfile (fallocate, dd fallback), 600, mkswap, swapon, one fstab line, sysctl drop-in', () => {
    expect(apply).toMatch(/^set -e; /);
    expect(apply).toContain('fallocate -l 2048M /swapfile');
    expect(apply).toContain('dd if=/dev/zero of=/swapfile bs=1M count=2048');
    expect(apply).toContain('chmod 600 /swapfile');
    expect(apply).toContain('mkswap /swapfile');
    expect(apply).toContain('swapon /swapfile');
    // Створення файлу — лише коли /swapfile ще не активний (повтор не чіпає робочу підкачку).
    expect(apply.indexOf('if ! swapon --show=NAME --noheadings | grep -qx /swapfile; then')).toBeLessThan(apply.indexOf('fallocate'));
    // Рядок у fstab додається лише якщо його немає.
    expect(apply).toContain('grep -q "^/swapfile " /etc/fstab || echo "/swapfile none swap sw 0 0" >> /etc/fstab');
    expect(apply).toContain(`echo "vm.swappiness=10" > ${SWAP_SYSCTL}`);
    expect(SWAP_SYSCTL.startsWith('/etc/sysctl.d/')).toBe(true);
  });

  it('a node that already has swap: the step is skipped without an apply call', async () => {
    const n = fakeNode({ user: true, docker: true, dir: true, ufw: true, swap: true });
    expect(await main(BOOT, n.deps)).toBe(0);
    expect(applied(n)).toEqual(['sshd']);
    expect(n.out.join('\n')).toContain('bootstrap: 5 swap — вже зроблено');
  });
});

describe('ufwOk', () => {
  it('accepts only an active default-deny firewall with 22/tcp as the single inbound rule', () => {
    expect(ufwOk(UFW_ACTIVE)).toBe(true);
    expect(ufwOk(UFW_ACTIVE.replace('Status: active', 'Status: inactive'))).toBe(false);
    expect(ufwOk(UFW_ACTIVE.replace('deny (incoming)', 'allow (incoming)'))).toBe(false);
    expect(ufwOk(`${UFW_ACTIVE}80/tcp                     ALLOW IN    Anywhere\n`)).toBe(false);
  });

  it('L1: ALLOW on 22 is the done state; a node with the LIMIT rule gets the step and migrates in one remote command', () => {
    expect(ufwOk(UFW_ACTIVE.replaceAll('ALLOW IN', 'LIMIT IN'))).toBe(false);
    const fw = ROOT_STEPS.find((x) => x.id === 'firewall');
    const argv = fw?.apply?.('/srv/t2f/rehearsal') ?? [];
    expect(argv.slice(0, 2)).toEqual(['sh', '-c']);
    const script = argv[2] ?? '';
    expect(script).not.toContain('ufw limit 22/tcp');
    // allow comes first, the old limit rule is removed after it: the port is never without a rule
    expect(script.indexOf('ufw allow 22/tcp')).toBeGreaterThan(-1);
    expect(script.indexOf('ufw delete limit 22/tcp')).toBeGreaterThan(script.indexOf('ufw allow 22/tcp'));
  });
});
