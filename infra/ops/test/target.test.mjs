// @ts-check
// F3 (AC-22 за адресою): інші написання старої адреси, DNS-імена й псевдоніми ssh, що ведуть на неї, — відмова до SSH.
import { describe, expect, it, vi } from 'vitest';
import { main } from '../ops.mjs';
import { isHostName, parseArgs } from '../lib/args.mjs';
import { prepareRealtime } from '../lib/capacity/prepareRealtime.mjs';
import { checkTarget, isForbiddenAddress, normalizeAddress } from '../lib/target.mjs';
import { createFakeExec } from './support/fakeExec.mjs';
import { fakeTarget } from './support/fakeTarget.mjs';

const OLD = '178.20.157.85';

describe('normalizeAddress / isForbiddenAddress', () => {
  it.each([
    ['178.20.157.85', '178.20.157.85'],
    ['::ffff:178.20.157.85', '178.20.157.85'],
    ['::FFFF:b214:9d55', '178.20.157.85'],
    ['0:0:0:0:0:ffff:b214:9d55', '178.20.157.85'],
    ['::178.20.157.85', '178.20.157.85'],
    ['2001:db8::1', '2001:db8:0:0:0:0:0:1'],
    ['::1', '0:0:0:0:0:0:0:1'],
  ])('%s → %s', (a, n) => {
    expect(normalizeAddress(a)).toBe(n);
  });

  it('flags the old server in every IP spelling and nothing else', () => {
    for (const a of ['178.20.157.85', '::ffff:178.20.157.85', '::ffff:b214:9d55', '::178.20.157.85']) expect(isForbiddenAddress(a)).toBe(true);
    for (const a of ['178.20.157.86', '203.0.113.10', '2001:db8::1', 'example.org']) expect(isForbiddenAddress(a)).toBe(false);
  });
});

describe('isHostName rejects names that are really numbers', () => {
  it.each([['0xb2.0x14.0x9d.0x55'], ['0xb2149d55'], ['178.20.157.0x55'], ['2987695445'], ['178.20.157.85.nip.io'], ['0262.024.0235.0125'], ['node.0x1']])(
    '%s → not a host name, and --target refuses it with 2',
    (v) => {
      expect(isHostName(v)).toBe(false);
      expect(parseArgs('deploy', ['--env', 'rehearsal', '--target', v])).toMatchObject({ ok: false, code: 2 });
    },
  );

  it('ordinary names still pass', () => {
    for (const v of ['node-1.example.org', 'rehearsal.time2fest.com', 'x0b.example.org', 'db1.example.org']) expect(isHostName(v)).toBe(true);
  });
});

describe('checkTarget (fake resolver, fake ssh -G)', () => {
  it('a DNS name that resolves to the old server → refused', async () => {
    const t = fakeTarget({ addresses: { 'sneaky.example.org': ['203.0.113.7', OLD] } });
    expect(await checkTarget('sneaky.example.org', t)).toMatchObject({ ok: false, code: 2 });
  });

  it('an IPv4-mapped IPv6 answer → refused', async () => {
    const t = fakeTarget({ addresses: { 'v6.example.org': ['::ffff:178.20.157.85'] } });
    expect(await checkTarget('v6.example.org', t)).toMatchObject({ ok: false, code: 2 });
  });

  it('an ~/.ssh/config alias whose hostname is the old server → refused (no DNS needed)', async () => {
    const t = fakeTarget({ sshHostnames: { oldprod: OLD } });
    expect(await checkTarget('oldprod', t)).toMatchObject({ ok: false, code: 2 });
  });

  it('an alias pointing to a name that resolves to the old server → refused', async () => {
    const t = fakeTarget({ sshHostnames: { box: 'legacy.example.org' }, addresses: { 'legacy.example.org': [OLD] } });
    expect(await checkTarget('box', t)).toMatchObject({ ok: false, code: 2 });
    expect(t.lookups).toEqual(['box', 'legacy.example.org']);
  });

  it('unresolvable name or failing ssh -G → refused (the check is never skipped)', async () => {
    const noDns = { ...fakeTarget(), lookupHost: async () => Promise.reject(new Error('ENOTFOUND')) };
    expect(await checkTarget('node.example.org', noDns)).toMatchObject({ ok: false, code: 2 });
    const empty = { ...fakeTarget(), lookupHost: async () => [] };
    expect(await checkTarget('node.example.org', empty)).toMatchObject({ ok: false, code: 2 });
    const noSsh = { ...fakeTarget(), sshHostname: async () => Promise.reject(new Error('no ssh')) };
    expect(await checkTarget('203.0.113.10', noSsh)).toMatchObject({ ok: false, code: 2 });
  });

  it('a clean name or IPv4 passes; an IPv4 literal is not looked up in DNS', async () => {
    const t = fakeTarget();
    expect(await checkTarget('node.example.org', t)).toEqual({ ok: true });
    expect(await checkTarget('203.0.113.10', t)).toEqual({ ok: true });
    expect(t.lookups).toEqual(['node.example.org']);
  });
});

describe('main runs the target check before the first ssh call', () => {
  /** @param {string[]} argv @param {ReturnType<typeof fakeTarget>} t */
  async function run(argv, t) {
    const fake = createFakeExec();
    /** @type {string[]} */
    const lines = [];
    const sshAs = vi.fn();
    const transport = vi.fn();
    const { lookupHost, sshHostname } = t;
    const code = await main(argv, { exec: fake, out: (l) => lines.push(l), env: {}, sshAs, transport, lookupHost, sshHostname });
    return { code, text: lines.join('\n'), calls: fake.calls.length, ssh: sshAs.mock.calls.length + transport.mock.calls.length };
  }

  it.each([
    [['deploy', '--env', 'rehearsal', '--target', 'sneaky.example.org']],
    [['rollback', '--env', 'rehearsal', '--target', 'sneaky.example.org']],
    [['bootstrap', '--host', 'sneaky.example.org']],
    [['edge-secret', '--env', 'rehearsal', '--rotate', '--target', 'sneaky.example.org']],
  ])('%j with a name resolving to the old server → 2, nothing run', async (argv) => {
    const r = await run(argv, fakeTarget({ addresses: { 'sneaky.example.org': [OLD] } }));
    expect(r.code).toBe(2);
    expect(r.calls).toBe(0);
    expect(r.ssh).toBe(0);
    expect(r.text).toContain('заборонену ціль');
  });

  it('bootstrap through an ssh alias of the old server → 2, nothing run', async () => {
    const r = await run(['bootstrap', '--host', 'oldprod'], fakeTarget({ sshHostnames: { oldprod: OLD } }));
    expect(r.code).toBe(2);
    expect(r.ssh).toBe(0);
  });
});

describe('capacity: the provider-returned address goes through the same check', () => {
  it('prepareRealtime refuses a node whose public IP is the old server before any ssh', async () => {
    const sshAs = vi.fn();
    const ctx = /** @type {any} */ ({
      args: { sub: 'capacity', env: 'rehearsal', values: {}, flags: {} },
      env: {},
      paths: { stateRoot: 'C:/nowhere' },
      out: () => {},
      err: () => {},
      deps: { sshAs, ...fakeTarget() },
    });
    for (const ip of [OLD, '::ffff:178.20.157.85']) {
      /** @type {import('../lib/capacity/provider.mjs').Node} */
      const node = { id: '1', name: 't2f-rehearsal-realtime', size: 's', status: 'active', tags: [], publicIp: ip, diskGb: 25 };
      await expect(prepareRealtime(ctx, node, 'services: {}\n', { now: () => 0, sleep: async () => {} })).rejects.toThrow(/заборонен/);
    }
    expect(sshAs).not.toHaveBeenCalled();
  });
});
