// @ts-check
// `ops capacity` на фейковому провайдері (AC-46 … AC-53, NFR-3, NFR-5). Мережі й справжнього SSH тест не торкається.
import { FAKE_TARGET } from '../support/fakeTarget.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProvider, FAKE_ENV_SIZES } from '../../lib/capacity/fake.mjs';
import { main } from '../../ops.mjs';

const M = 't2f-managed';
const E = 't2f-env-rehearsal';
const MAIN = { name: 't2f-rehearsal-main', size: 's-2vcpu-4gb', tags: [M, E, 't2f-role-main'] };
const RT = { name: 't2f-rehearsal-realtime', size: 's-2vcpu-4gb', tags: [M, E, 't2f-role-realtime'] };
const CLOUDFLARED_ONLY = 'services:\n  cloudflared:\n    image: cloudflare/cloudflared@sha256:' + 'a'.repeat(64) + '\n    restart: unless-stopped\n    env_file: [cloudflared.env]\n';
const UFW_OK =
  'Status: active\nLogging: on (low)\nDefault: deny (incoming), allow (outgoing), disabled (routed)\nNew profiles: skip\n\n' +
  'To                         Action      From\n--                         ------      ----\n22/tcp                     LIMIT IN    Anywhere\n22/tcp (v6)                LIMIT IN    Anywhere (v6)\n';

/** @type {string[]} */
const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * @param {{ nodes?: import('../../lib/capacity/fake.mjs').SeedNode[], compose?: string, deps?: Record<string, unknown>, env?: Record<string, string> }} [o]
 */
function world(o = {}) {
  const fake = createFakeProvider({ nodes: o.nodes ?? [MAIN] });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-capacity-'));
  temps.push(dir);
  const composeFile = path.join(dir, 'compose.realtime.yml');
  fs.writeFileSync(composeFile, o.compose ?? CLOUDFLARED_ONLY);
  /** @type {string[]} */
  let lines = [];
  /** @type {{ user: string, argv: string[], input?: unknown }[]} */
  const remote = [];
  /** @param {{ user: string }} o */
  const sshAs = ({ user }) => ({
    kind: /** @type {const} */ ('ssh'),
    describe: `fake ${user}`,
    exec: async (/** @type {string[]} */ argv, /** @type {any} */ opts) => {
      remote.push({ user, argv, input: opts?.input });
      return { code: 0, stdout: argv[0] === 'ufw' ? UFW_OK : '', stderr: '' };
    },
  });
  let t = 0;
  const clock = { now: () => t, sleep: async (/** @type {number} */ ms) => void (t += ms) };
  const exec = {
    run: async () => ({ code: 0, stdout: '203.0.113.1 ED25519 SHA256:fakefingerprint', stderr: '' }),
    localTransport: () => {
      throw new Error('у тесті немає локального транспорту');
    },
    sshTransport: () => {
      throw new Error('у тесті немає справжнього SSH');
    },
  };
  const deps = /** @type {any} */ ({
    out: (/** @type {string} */ l) => lines.push(l),
    env: o.env ?? {},
    exec,
    now: () => new Date('2026-11-17T10:00:00Z'),
    provider: async () => ({ name: 'fake', provider: fake.provider, envSizes: FAKE_ENV_SIZES }),
    paths: { stateRoot: dir, realtimeComposeFile: composeFile },
    sshAs,
    clock,
    ...FAKE_TARGET,
    ...o.deps,
  });
  return {
    fake,
    remote,
    dir,
    deps,
    journal: () =>
      fs
        .readFileSync(path.join(dir, 'rehearsal', 'capacity.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    /** Запуск; повертає код і вивід саме цього запуску. @param {...string} argv */
    async run(...argv) {
      lines = [];
      const code = await main(['capacity', '--env', 'rehearsal', ...argv], deps);
      return { code, text: lines.join('\n') };
    },
  };
}

describe('capacity: план без --confirm', () => {
  it('0 змінних викликів і ціна за годину для кожного кроку, що створює чи збільшує', async () => {
    const w = world();
    const night = await w.run('night', '--size', 's-4vcpu-8gb');
    expect(night.code).toBe(0);
    expect(night.text).toContain('збільшити t2f-rehearsal-main: s-2vcpu-4gb → s-4vcpu-8gb (лише CPU і RAM, диск без змін) — $0.07143/год');
    expect(night.text).toContain('лише план; щоб виконати — --confirm rehearsal');
    const rt = await w.run('realtime-create');
    expect(rt.code).toBe(0);
    expect(rt.text).toContain('створити t2f-rehearsal-realtime (s-2vcpu-4gb, fra1, теги t2f-managed t2f-env-rehearsal t2f-role-realtime) — $0.03571/год');
    expect(w.fake.mutating()).toEqual([]);
    expect(w.remote).toEqual([]);
  });

  it('plan — інвентар з цінами й дозволеними розмірами', async () => {
    const w = world();
    const r = await w.run('plan');
    expect(r.code).toBe(0);
    expect(r.text).toContain('t2f-rehearsal-main — основний, s-2vcpu-4gb, active');
    expect(r.text).toContain('дозволені s-2vcpu-4gb, s-4vcpu-8gb');
    expect(r.text).toContain('s-4vcpu-8gb — 4 vCPU, 8192 MB RAM, диск 160 GB — $0.07143/год');
    expect(w.fake.mutating()).toEqual([]);
  });

  it('--confirm іншого середовища — відмова 2', async () => {
    const w = world();
    expect((await w.run('back', '--confirm', 'prelaunch')).code).toBe(2);
    expect(w.fake.calls).toEqual([]);
  });
});

describe('capacity: запобіжники', () => {
  it('вузол без обох тегів — відмова з його назвою, 0 видалень', async () => {
    const w = world({ nodes: [MAIN, { name: 'rt-manual', size: 's-2vcpu-4gb', tags: [E, 't2f-role-realtime'] }] });
    for (const action of ['realtime-delete', 'off-season', 'realtime-create']) {
      const r = await w.run(action, '--confirm', 'rehearsal');
      expect(r.code).toBe(2);
      expect(r.text).toContain('rt-manual');
    }
    expect(w.fake.mutating()).toEqual([]);
    const st = await w.run('status');
    expect(st.text).toContain('rt-manual: немає обох тегів t2f-managed і t2f-env-rehearsal — не змінюється');
  });

  it('розмір поза переліком дозволених — 2, без змін', async () => {
    const w = world();
    const r = await w.run('night', '--size', 's-8vcpu-16gb', '--confirm', 'rehearsal');
    expect(r.code).toBe(2);
    expect(r.text).toContain('s-8vcpu-16gb не в переліку дозволених');
    expect(w.fake.mutating()).toEqual([]);
  });

  it('невідомий T2F_PROVIDER — 2', async () => {
    const w = world({ env: { T2F_PROVIDER: 'nope' }, deps: { provider: undefined } });
    const r = await w.run('plan');
    expect(r.code).toBe(2);
    expect(r.text).toContain('T2F_PROVIDER');
  });

  it('профіль realtime із сервісом server — відмова 2 до створення', async () => {
    const w = world({ compose: 'services:\n  cloudflared:\n    image: x\n  server:\n    image: t2f-server:abc\n' });
    const r = await w.run('realtime-create', '--confirm', 'rehearsal');
    expect(r.code).toBe(2);
    expect(r.text).toContain('лише cloudflared');
    expect(w.fake.mutating()).toEqual([]);
  });
});

describe('capacity: виконання', () => {
  it('зміна розміру основного вузла — лише CPU/RAM (disk:false), туди й назад', async () => {
    const w = world();
    expect((await w.run('night', '--size', 's-4vcpu-8gb', '--confirm', 'rehearsal')).code).toBe(0);
    expect((await w.run('back', '--confirm', 'rehearsal')).code).toBe(0);
    expect(w.fake.resizes.map(({ size, disk }) => ({ size, disk }))).toEqual([
      { size: 's-4vcpu-8gb', disk: false },
      { size: 's-2vcpu-4gb', disk: false },
    ]);
    expect(w.fake.mutating().map((c) => c.method)).toEqual(['resizeNode', 'resizeNode']);
  });

  it('realtime-create / realtime-delete — create + підготовка + delete; жодної зміни розміру чи вимкнення', async () => {
    const w = world();
    const c = await w.run('realtime-create', '--confirm', 'rehearsal');
    expect(c.code).toBe(0);
    const node = w.fake.nodes.find((n) => n.name === 't2f-rehearsal-realtime');
    expect(node?.tags).toEqual([M, E, 't2f-role-realtime']);
    const upload = w.remote.find((r) => r.argv.includes('/srv/t2f/rehearsal-realtime') && String(r.argv[2]).includes('compose.realtime.yml'));
    expect(upload).toMatchObject({ user: 'deploy', input: CLOUDFLARED_ONLY });
    expect(c.text).toContain('не запущено');
    // Повтор: вузол є й підготовлений — нічого робити.
    const again = await w.run('realtime-create', '--confirm', 'rehearsal');
    expect(again.text).toContain('нічого робити');
    const d = await w.run('realtime-delete', '--confirm', 'rehearsal');
    expect(d.code).toBe(0);
    expect(w.fake.nodes.map((n) => n.name)).toEqual(['t2f-rehearsal-main']);
    expect(w.fake.mutating().map((x) => x.method)).toEqual(['createNode', 'deleteNode']);
    const steps = w.journal().map((r) => [r.step, r.result, typeof r.seconds]);
    expect(steps).toEqual([
      ['create', 'ok', 'number'],
      ['prepare', 'ok', 'number'],
      ['delete', 'ok', 'number'],
    ]);
    // Жодна віддалена команда нічого не запускає (AC-50).
    expect(w.remote.every((r) => !r.argv.includes('up') && !r.argv.includes('start') && !r.argv.includes('server'))).toBe(true);
  });

  it('жоден план не має кроку, що запускає server', async () => {
    const w = world({ nodes: [{ ...MAIN, size: 's-4vcpu-8gb' }, RT] });
    for (const [action, ...rest] of [['plan'], ['status'], ['night', '--size', 's-2vcpu-4gb'], ['back'], ['off-season'], ['realtime-create'], ['realtime-delete']]) {
      const r = await w.run(action, ...rest);
      expect(r.code).toBe(0);
      expect(r.text).not.toMatch(/\bserver\b|\bup\b|запуст(ити|ни)/i);
    }
    expect(w.fake.mutating()).toEqual([]);
  });

  it('429 на кроці 2 — зупинка з переліком виконаного; повтор виконує лише крок 2', async () => {
    const w = world({ nodes: [{ ...MAIN, size: 's-4vcpu-8gb' }, RT] });
    // Виклики: listNodes, listNodes, sizes, resizeNode (крок 1), deleteNode (крок 2).
    w.fake.failOnCall(5, 429, 30);
    const first = await w.run('off-season', '--confirm', 'rehearsal');
    expect(first.code).toBe(1);
    expect(first.text).toContain('крок 2 не вдався: видалити t2f-rehearsal-realtime');
    expect(first.text).toContain('HTTP 429');
    expect(first.text).toContain('виконано: 1. зменшити t2f-rehearsal-main');
    const second = await w.run('off-season', '--confirm', 'rehearsal');
    expect(second.code).toBe(0);
    expect(second.text).not.toContain('зменшити');
    expect(second.text).toContain('1. видалити t2f-rehearsal-realtime');
    const methods = w.fake.mutating().map((c) => [c.method, c.failed ?? 'ok']);
    expect(methods).toEqual([
      ['resizeNode', 'ok'],
      ['deleteNode', 429],
      ['deleteNode', 'ok'],
    ]);
  });

  it('збільшений основний + realtime → off-season «зменшити, видалити», після виконання status без розбіжностей', async () => {
    const w = world({ nodes: [{ ...MAIN, size: 's-4vcpu-8gb' }, RT] });
    const before = await w.run('status');
    expect(before.text).toContain('основний вузол t2f-rehearsal-main: розмір s-4vcpu-8gb');
    expect(before.text).toContain('вузол realtime t2f-rehearsal-realtime є');
    const plan = await w.run('off-season');
    expect(plan.text).toMatch(/1\. зменшити t2f-rehearsal-main: s-4vcpu-8gb → s-2vcpu-4gb[^\n]*\n\s+2\. видалити t2f-rehearsal-realtime/);
    expect((await w.run('off-season', '--confirm', 'rehearsal')).code).toBe(0);
    const after = await w.run('status');
    expect(after.text).toContain('розбіжностей немає');
  });

  it('--probe: простій зміни розміру — у журнал і у вивід (NFR-3)', async () => {
    /** @type {string[]} */
    const urls = [];
    const w = world({
      deps: {
        startProbe: (/** @type {{ url?: string }} */ o) => {
          urls.push(String(o.url));
          return { stop: () => ({ downtimeSeconds: 42, samples: 60, failures: 42 }) };
        },
        fetch: async () => new Response('ok', { status: 200 }),
      },
    });
    const r = await w.run('night', '--size', 's-4vcpu-8gb', '--confirm', 'rehearsal', '--probe');
    expect(r.code).toBe(0);
    expect(urls).toEqual(['https://rehearsal.time2fest.com/api/health']);
    expect(r.text).toContain('простій 42 с');
    expect(w.journal()).toEqual([
      expect.objectContaining({ step: 'resize', result: 'ok', from: 's-2vcpu-4gb', to: 's-4vcpu-8gb', downtimeSeconds: 42, env: 'rehearsal', action: 'night' }),
    ]);
  });
});
