// @ts-check
// O·P18a: `ops capacity server2-create | server2-delete` на фейковому провайдері — теги, VPC основного вузла, розмір,
// ціна до платної дії, відмови до будь-якої зміни, видалення лише вузла з трьома тегами (ніколи основного).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { ENV_SIZES as DO_ENV_SIZES } from '../../lib/capacity/digitalocean/config.mjs';
import { createFakeProvider, FAKE_ENV_SIZES, FAKE_VPC } from '../../lib/capacity/fake.mjs';
import { main } from '../../ops.mjs';
import { FAKE_TARGET } from '../support/fakeTarget.mjs';

const M = 't2f-managed';
const E = 't2f-env-rehearsal';
const S2 = 't2f-role-server2';
const MAIN = { name: 't2f-rehearsal-main', size: 's-1vcpu-2gb', tags: [M, E, 't2f-role-main'], privateIp: '10.114.0.2' };
// O·P16: підготовка вузла вимірює час (chronyc tracking) — синхронізовано, зсув 12 мс.
const CHRONY_OK = `System time     : 0.012000000 seconds fast of NTP time${String.fromCharCode(10)}Leap status     : Normal${String.fromCharCode(10)}`;
const UFW_OK =
  'Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nNew profiles: skip\n\n' +
  'To                         Action      From\n--                         ------      ----\n22/tcp                     ALLOW IN    Anywhere\n22/tcp (v6)                ALLOW IN    Anywhere (v6)\n';

/** @type {string[]} */
const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** @param {{ nodes?: import('../../lib/capacity/fake.mjs').SeedNode[] }} [o] */
function world(o = {}) {
  const fake = createFakeProvider({ nodes: o.nodes ?? [MAIN] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-server2-cap-'));
  temps.push(dir);
  /** @type {string[]} */
  let lines = [];
  /** @type {{ user: string, argv: string[] }[]} */
  const remote = [];
  const sshAs = (/** @type {{ user: string }} */ { user }) => ({
    kind: /** @type {const} */ ('ssh'),
    describe: `fake ${user}`,
    exec: async (/** @type {string[]} */ argv) => {
      remote.push({ user, argv });
      return { code: 0, stdout: argv[0] === 'ufw' ? UFW_OK : argv[0] === 'chronyc' ? CHRONY_OK : '', stderr: '' };
    },
  });
  let t = 0;
  const deps = /** @type {any} */ ({
    out: (/** @type {string} */ l) => lines.push(l),
    env: {},
    exec: {
      run: async () => ({ code: 0, stdout: '203.0.113.1 ED25519 SHA256:fakefingerprint', stderr: '' }),
      localTransport: () => {
        throw new Error('немає локального транспорту');
      },
      sshTransport: () => {
        throw new Error('немає справжнього SSH');
      },
    },
    now: () => new Date('2026-11-18T10:00:00Z'),
    provider: async () => ({ name: 'fake', provider: fake.provider, envSizes: FAKE_ENV_SIZES }),
    paths: { stateRoot: dir, realtimeComposeFile: path.join(dir, 'missing.yml') },
    sshAs,
    clock: { now: () => t, sleep: async (/** @type {number} */ ms) => void (t += ms) },
    ...FAKE_TARGET,
  });
  return {
    fake,
    remote,
    /** @param {string} env @param {...string} argv */
    async runEnv(env, ...argv) {
      lines = [];
      const code = await main(['capacity', '--env', env, ...argv], deps);
      return { code, text: lines.join('\n') };
    },
    /** @param {...string} argv */
    run(...argv) {
      return this.runEnv('rehearsal', ...argv);
    },
  };
}

describe('capacity server2-create', () => {
  it('план без --confirm: розмір s-1vcpu-2gb, ціна за годину, VPC основного, три теги; нічого не змінюється', async () => {
    const w = world();
    const r = await w.run('server2-create');
    expect(r.code).toBe(0);
    expect(r.text).toContain(`створити t2f-rehearsal-server2 (s-1vcpu-2gb, fra1, VPC ${FAKE_VPC}, теги ${M} ${E} ${S2}) — $0.01786/год`);
    expect(r.text).toContain('лише план; щоб виконати — --confirm rehearsal');
    expect(w.fake.mutating()).toEqual([]);
    expect(DO_ENV_SIZES.rehearsal.server2?.size).toBe('s-1vcpu-2gb');
    expect(DO_ENV_SIZES.production.server2).toBeUndefined();
  });

  it('--confirm: створює вузол у VPC основного й готує його (bootstrap), нічого не запускає', async () => {
    const w = world();
    const r = await w.run('server2-create', '--confirm', 'rehearsal');
    expect(r.code).toBe(0);
    const created = w.fake.calls.find((c) => c.method === 'createNode');
    expect(created?.args[0]).toMatchObject({ name: 't2f-rehearsal-server2', size: 's-1vcpu-2gb', region: 'fra1', tags: [M, E, S2], vpcId: FAKE_VPC });
    // Підготовка: каталог другого вузла від імені root, потім bootstrap (ufw лише 22/tcp, підкачка).
    expect(w.remote.some((x) => x.user === 'root' && x.argv.includes('/srv/t2f/rehearsal-server2'))).toBe(true);
    expect(w.remote.some((x) => x.argv[0] === 'ufw')).toBe(true);
    expect(w.remote.every((x) => !x.argv.includes('up') && !x.argv.includes('server'))).toBe(true);
    expect(r.text).toContain('сервер не запущено');
  });

  it('--size лише з дозволених; інший розмір — відмова 2 до будь-якого виклику провайдера, що змінює', async () => {
    const w = world();
    const ok = await w.run('server2-create', '--size', 's-2vcpu-2gb');
    expect(ok.text).toContain('(s-2vcpu-2gb, fra1');
    const bad = await w.run('server2-create', '--size', 's-8vcpu-16gb', '--confirm', 'rehearsal');
    expect(bad.code).toBe(2);
    expect(w.fake.mutating()).toEqual([]);
  });

  it('другий create — відмова 2, другого вузла не створює', async () => {
    const w = world();
    expect((await w.run('server2-create', '--confirm', 'rehearsal')).code).toBe(0);
    const again = await w.run('server2-create', '--confirm', 'rehearsal');
    expect(again.code).toBe(2);
    expect(again.text).toContain('уже є');
    expect(w.fake.mutating().map((c) => c.method)).toEqual(['createNode']);
  });

  it('production — відмова 2 ще до провайдера (і для delete)', async () => {
    const w = world();
    for (const action of ['server2-create', 'server2-delete']) {
      const r = await w.runEnv('production', action, '--confirm', 'production', '--allow-main-domain');
      expect(r.code).toBe(2);
    }
    expect(w.fake.calls).toEqual([]);
  });

  it('VPC основного невідома чи основних не один — відмова 2', async () => {
    const noVpc = world({ nodes: [{ ...MAIN, vpcId: null }] });
    expect((await noVpc.run('server2-create', '--confirm', 'rehearsal')).code).toBe(2);
    const none = world({ nodes: [] });
    expect((await none.run('server2-create', '--confirm', 'rehearsal')).code).toBe(2);
    expect([...noVpc.fake.mutating(), ...none.fake.mutating()]).toEqual([]);
  });
});

describe('capacity server2-delete', () => {
  it('видаляє лише вузол з трьома тегами й друкує, що лишилося', async () => {
    const w = world({ nodes: [MAIN, { name: 't2f-rehearsal-server2', size: 's-1vcpu-2gb', tags: [M, E, S2], privateIp: '10.114.0.3' }] });
    const plan = await w.run('status');
    expect(plan.text).toContain('другий сервер (тимчасовий) t2f-rehearsal-server2 є');
    const r = await w.run('server2-delete', '--confirm', 'rehearsal');
    expect(r.code).toBe(0);
    expect(w.fake.nodes.map((n) => n.name)).toEqual(['t2f-rehearsal-main']);
    expect(r.text).toMatch(/лишилося:[\s\S]*t2f-rehearsal-main — основний/);
    expect(r.text).not.toMatch(/лишилося:[\s\S]*t2f-rehearsal-server2/);
  });

  it('основний вузол не обирається ніколи — навіть з тегом server2 чи з іменем другого вузла', async () => {
    const both = world({ nodes: [{ ...MAIN, tags: [...MAIN.tags, S2] }] });
    const r = await both.run('server2-delete', '--confirm', 'rehearsal');
    expect(r.code).toBe(0);
    expect(r.text).toContain('нічого робити');
    expect(both.fake.mutating()).toEqual([]);
    // Ім’я саме по собі нічого не обирає: вузол з ім’ям другого, але без тегу ролі, — не видаляється.
    const named = world({ nodes: [MAIN, { name: 't2f-rehearsal-server2', size: 's-1vcpu-2gb', tags: [M, E] }] });
    const n = await named.run('server2-delete', '--confirm', 'rehearsal');
    expect(n.text).toContain('нічого робити');
    expect(named.fake.mutating()).toEqual([]);
  });

  it('вузол з роллю server2 без обох тегів — відмова 2 з його назвою', async () => {
    const w = world({ nodes: [MAIN, { name: 'stray', size: 's-1vcpu-2gb', tags: [E, S2] }] });
    const r = await w.run('server2-delete', '--confirm', 'rehearsal');
    expect(r.code).toBe(2);
    expect(r.text).toContain('stray');
    expect(w.fake.mutating()).toEqual([]);
  });

  it('провайдер сам перевіряє тег ролі під час видалення (requireTags)', async () => {
    const w = world({ nodes: [MAIN, { name: 't2f-rehearsal-server2', size: 's-1vcpu-2gb', tags: [M, E, S2] }] });
    const target = w.fake.nodes.find((n) => n.name === 't2f-rehearsal-server2');
    // Між плануванням і видаленням тег ролі зник: провайдер відмовляє, вузол лишається.
    const orig = w.fake.provider.deleteNode;
    w.fake.provider.deleteNode = async (id, opts) => {
      if (target) target.tags = [M, E];
      return orig(id, opts);
    };
    const r = await w.run('server2-delete', '--confirm', 'rehearsal');
    expect(r.code).toBe(1);
    expect(w.fake.nodes.map((n) => n.name)).toContain('t2f-rehearsal-server2');
  });
});
