// @ts-check
// O·P17 (W56, AC-70…AC-72): `ops scheduler-drill` на підставних вузлах із власним станом — оренда планувальника,
// віртуальний годинник, записи моментів, контейнери. Час — підставний (сон лише пересуває годинник).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it } from 'vitest';
import {
  drillLine, holderHost, isZoneMidnight, measure, memoryShortMb, parseMemAvailableMb, parseStatus, realTimeOf,
  recordPairs, tallyRecords,
} from '../lib/drill.mjs';
import { assertAllowed, assertArgv, DEFAULT_REMOTE_ALLOW } from '../lib/exec.mjs';
import { main } from '../ops.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const MAIN = '203.0.113.10';
const SECOND = '203.0.113.20';
const MIDNIGHT = '2026-12-31T10:00:00Z';
const MIDNIGHT_MS = Date.parse(MIDNIGHT);
const KEY = 'midnight:+14:00';
const DUE = [{ action: 'live-midnight', key: KEY }, { action: 'stamp-window', key: KEY }];
const LAT = 50;
const SECOND_IP_OUT = [
  '2: eth0    inet 203.0.113.20/20 brd 203.0.127.255 scope global eth0',
  '3: eth1    inet 10.114.0.3/20 brd 10.114.15.255 scope global eth1',
  '---',
  'default via 203.0.112.1 dev eth0 proto static',
  '',
].join('\n');

const cleanups = /** @type {(() => void)[]} */ ([]);
afterEach(() => {
  while (cleanups.length) cleanups.pop()?.();
});

/**
 * @typedef {{ host: string, project: string, service: string, id: string, hostname: string, running: boolean }} FakeInst
 * @typedef {{
 *   mode?: 'one-node' | 'two-nodes',
 *   holder?: 'main' | 'drill' | 'second',
 *   memKb?: number,
 *   privateDbOpen?: boolean,
 *   secondHealthy?: boolean,
 *   takeoverDelay?: number,
 *   duplicate?: boolean,
 *   missAction?: boolean,
 *   noDue?: boolean,
 *   edgeDown?: boolean,
 *   failWhen?: (a: string) => boolean,
 * }} WorldOpts
 */

/** @param {WorldOpts} [o] */
function world(o = {}) {
  const mode = o.mode ?? 'one-node';
  let t = 1_000_000;
  const clock = { now: () => t, sleep: async (/** @type {number} */ ms) => void (t += Math.max(0, ms)) };
  /** @type {Record<'main' | 'drill' | 'second', FakeInst & { exists: boolean }>} */
  const inst = {
    main: { host: MAIN, project: 't2f-rehearsal', service: 'server', id: 'a'.repeat(64), hostname: 'aaaaaaaaaaaa', running: true, exists: true },
    drill: { host: MAIN, project: 't2f-rehearsal', service: 'server-drill', id: 'b'.repeat(64), hostname: 'bbbbbbbbbbbb', running: false, exists: false },
    second: { host: SECOND, project: 't2f-rehearsal-server2', service: 'server', id: 'c'.repeat(64), hostname: 'cccccccccccc', running: mode === 'two-nodes' && o.secondHealthy !== false, exists: mode === 'two-nodes' },
  };
  // Власник `drill` задається, коли екземпляр навчання піднімається (див. `up`).
  const lease = { holder: /** @type {'main' | 'drill' | 'second'} */ (o.holder === 'second' ? 'second' : 'main'), epoch: 7, stoppedAt: /** @type {number | null} */ (null), takenAt: /** @type {number | null} */ (null) };
  const vclock = { virtual: false, base: 0, realBase: 0, speed: 1, runEpoch: 3 };
  /** @type {{ keys: string[], action: string }[]} */
  let records = [];
  let recorded = false;
  /** @type {{ host: string, argv: string[] }[]} */
  const calls = [];
  /** @type {Map<string, string>} */
  const files = new Map();
  const vnow = () => vclock.base + (t - vclock.realBase) * vclock.speed;

  /** Оренда й записи на момент `t`. */
  function tick() {
    const h = inst[lease.holder];
    if (!h.running && lease.stoppedAt !== null && t >= lease.stoppedAt + (o.takeoverDelay ?? 6000)) {
      const next = /** @type {const} */ (['main', 'drill', 'second']).find((n) => n !== lease.holder && inst[n].running);
      if (next) {
        lease.holder = next;
        lease.epoch += 1;
        lease.takenAt = t;
        lease.stoppedAt = null;
      }
    }
    const midnightReal = vclock.realBase + (MIDNIGHT_MS - vclock.base) / vclock.speed;
    if (vclock.virtual && !recorded && inst[lease.holder].running && vnow() >= MIDNIGHT_MS && t >= Math.max(midnightReal, lease.takenAt ?? 0) + 200) {
      recorded = true;
      for (const d of o.missAction ? DUE.slice(0, 1) : DUE) records.push({ keys: [d.key], action: d.action });
      if (o.duplicate) records.push({ keys: [KEY], action: DUE[0].action });
    }
  }

  /** @param {string} host @param {string[]} argv @param {string} input @returns {{ code?: number, stdout?: string }} */
  function handle(host, argv, input) {
    const a = argv.join(' ');
    if (o.failWhen?.(a)) return { code: 1 };
    if (argv[0] === 'cat' && argv[1] === '/proc/meminfo') return { stdout: `MemTotal:        2014712 kB\nMemAvailable:   ${o.memKb ?? 1_200_000} kB\n` };
    if (argv[0] === 'sh') {
      const script = argv[2];
      if (script.startsWith('ip -4')) return { stdout: host === SECOND ? SECOND_IP_OUT : '' };
      if (script.includes('cat > "$1.tmp"')) {
        files.set(argv[4], input);
        return {};
      }
      if (script === 'rm -f -- "$1"') {
        files.delete(argv[4]);
        return {};
      }
      if (script === 'test ! -e "$1" || cat -- "$1"') return { stdout: o.privateDbOpen ? 'T2F_PRIVATE_DB_PEER=10.114.0.3\n' : '' };
    }
    if (a.startsWith('docker ps -aq --filter label=com.docker.compose.project=t2f-rehearsal-private-db')) return { stdout: o.privateDbOpen ? 'd'.repeat(12) : '' };
    if (a.startsWith('docker inspect')) {
      const i = Object.values(inst).find((x) => x.id === argv[argv.length - 1]);
      return i ? { stdout: `${i.hostname}\n` } : { code: 1 };
    }
    if (argv[0] === 'docker' && argv[1] === 'compose') {
      const project = argv[argv.indexOf('-p') + 1];
      const service = argv.includes('server-drill') ? 'server-drill' : 'server';
      const i = Object.values(inst).find((x) => x.host === host && x.project === project && x.service === service);
      if (!i) return { code: 1 };
      const name = /** @type {'main' | 'drill' | 'second'} */ (Object.keys(inst).find((k) => inst[/** @type {'main'} */ (k)] === i));
      let at = 2;
      while (['-p', '-f', '--env-file', '--profile'].includes(argv[at])) at += 2;
      const verb = argv[at];
      if (verb === 'exec') {
        if (!i.running) return { code: 1 };
        if (a.includes('health-probe.mjs')) return { stdout: `200 ${'e'.repeat(40)}\n` };
        const cli = argv.slice(argv.indexOf('clock') + 1);
        return { stdout: `> clock\n${JSON.stringify(clockCli(cli))}\n` };
      }
      if (verb === 'up') {
        Object.assign(i, { running: true, exists: true });
        if (o.holder === 'drill' && name === 'drill') lease.holder = 'drill';
        return {};
      }
      if (verb === 'ps') return { stdout: i.running ? `${i.id}\n` : '' };
      // SIGKILL — смерть: оренда лишається за мертвим до кінця строку (перехоплення через `takeoverDelay`).
      if (verb === 'kill' && argv.includes('SIGKILL')) {
        i.running = false;
        if (lease.holder === name) lease.stoppedAt = t;
        return {};
      }
      // Благодатна зупинка — як у сервера: `stop()` планувальника звільняє оренду, інший бере її одразу.
      if (verb === 'stop') {
        i.running = false;
        const next = /** @type {const} */ (['main', 'drill', 'second']).find((n) => n !== name && inst[n].running);
        if (lease.holder === name && next) {
          lease.holder = next;
          lease.epoch += 1;
          lease.takenAt = t;
        }
        return {};
      }
      if (verb === 'start') {
        i.running = true;
        return {};
      }
      if (verb === 'restart') {
        if (lease.holder === name && inst.main.running) {
          lease.holder = 'main';
          lease.epoch += 1;
        }
        return {};
      }
      if (verb === 'rm') {
        Object.assign(i, { running: false, exists: false });
        return {};
      }
    }
    return {};
  }

  /** @param {string[]} cli */
  function clockCli(cli) {
    const [cmd] = cli;
    if (cmd === 'restart-night') {
      vclock.runEpoch += 1;
      records = [];
      recorded = false;
      Object.assign(vclock, { virtual: true, base: Date.parse('2026-12-31T09:30:00Z'), realBase: t, speed: 60 });
    }
    if (cmd === 'set') Object.assign(vclock, { virtual: true, base: Date.parse(cli[2]), realBase: t });
    if (cmd === 'speed') Object.assign(vclock, { base: vnow(), realBase: t, speed: Number(cli[1]) });
    if (cmd === 'real') vclock.virtual = false;
    if (cmd === 'records') return { epoch: Number(cli[2]), records: Number(cli[2]) === vclock.runEpoch ? records : [] };
    const h = inst[lease.holder];
    return {
      ok: true,
      value: {
        lease: { holder: `${h.hostname}:1:0badc0de`, epoch: lease.epoch, expiresInMs: 4000 },
        runEpoch: vclock.runEpoch,
        now: new Date(vclock.virtual ? vnow() : t).toISOString(),
        speed: vclock.speed,
        frozen: false,
        nextMoment: vclock.virtual ? { key: KEY, at: MIDNIGHT, ...(o.noDue ? {} : { due: DUE }) } : null,
      },
    };
  }

  /** @param {string} host */
  const transport = (host) => ({
    kind: /** @type {const} */ ('ssh'),
    describe: `ssh:${host}`,
    /** @param {string[]} argv @param {import('../lib/exec.mjs').RunOpts} [opts] */
    async exec(argv, opts = {}) {
      assertArgv(argv);
      assertAllowed(argv, opts.allow ?? DEFAULT_REMOTE_ALLOW);
      const input = typeof opts.input === 'string' ? opts.input : '';
      calls.push({ host, argv: [...argv] });
      t += LAT;
      tick();
      const r = handle(host, argv, input);
      tick();
      return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: '' };
    },
    /** Замок вузла: одразу `locked`. @param {string[]} argv */
    start(argv) {
      calls.push({ host, argv: [...argv] });
      const stdout = new PassThrough();
      const stdin = new PassThrough();
      /** @type {(v: any) => void} */
      let finish = () => {};
      const done = new Promise((resolve) => {
        finish = resolve;
      });
      stdin.on('finish', () => finish({ code: 0, stdout: '', stderr: '' }));
      setImmediate(() => stdout.write('locked\n'));
      return { stdout, stdin, done: /** @type {Promise<any>} */ (done), kill: () => finish({ code: 143, stdout: '', stderr: '' }) };
    },
  });

  const stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-drill-'));
  cleanups.push(() => fs.rmSync(stateRoot, { recursive: true, force: true }));
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
    clock,
    edgeCheck: async () => !o.edgeDown && inst.main.running,
    transport: (/** @type {{ host: string } | null} */ ssh) => {
      transports += 1;
      if (!ssh || (ssh.host !== MAIN && ssh.host !== SECOND)) throw new Error('фейк: невідомий вузол');
      return transport(ssh.host);
    },
  };

  /** Скорочення викликів, що щось змінюють, у порядку виконання. */
  const changes = () =>
    calls
      .map((c) => {
        const a = c.argv.join(' ');
        const who = c.host === SECOND ? 'second' : 'main';
        if (c.argv[0] === 'sh' && c.argv[2].includes('cat > "$1.tmp"')) return `${who}: write ${path.posix.basename(c.argv[4])}`;
        if (c.argv[0] === 'sh' && c.argv[2] === 'rm -f -- "$1"') return `${who}: rm ${path.posix.basename(c.argv[4])}`;
        if (c.argv[1] !== 'compose') return null;
        const m = a.match(/ (up -d --no-deps \S+|kill -s SIGKILL \S+|stop \S+|start \S+|restart \S+|rm -sf \S+)$/);
        if (m) return `${who}: ${m[1]}`;
        const k = a.match(/pnpm run clock (restart-night|set --at \S+|speed \S+|real)$/);
        return k ? `${who}: clock ${k[1]}` : null;
      })
      .filter(Boolean);

  const journal = () => {
    const f = path.join(stateRoot, 'rehearsal', 'server2.jsonl');
    return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  };
  return { deps, calls, changes, journal, inst, vclock, lease, files, out, err, transports: () => transports, clock };
}

/** @param {string[]} extra */
const oneNode = (...extra) => ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'one-node', '--midnight', MIDNIGHT, ...extra];
/** @param {string[]} extra */
const twoNodes = (...extra) => ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'two-nodes', '--second', SECOND, '--midnight', MIDNIGHT, ...extra];
const RE_LINE = /^DRILL takeover_ms=(\d+) late_ms=(\d+) duplicates=(\d+) missed=(\d+)$/;
/** @param {string[]} out */
const drillOf = (out) => {
  const m = out.map((l) => l.match(RE_LINE)).find(Boolean);
  return m ? { takeover: Number(m[1]), late: Number(m[2]), duplicates: Number(m[3]), missed: Number(m[4]) } : null;
};

describe('scheduler-drill: відмови до будь-якої зміни (AC-71, AC-72)', () => {
  it('production і prelaunch — код 2, жодного транспорту', async () => {
    for (const env of ['production', 'prelaunch']) {
      const w = world();
      const argv = oneNode();
      argv[argv.indexOf('rehearsal')] = env;
      expect(await main(argv, w.deps)).toBe(2);
      expect(w.transports()).toBe(0);
      expect(w.calls).toEqual([]);
    }
  });

  it('--resize — код 2 без з’єднання, і з --confirm-resize теж (розмір вузла не змінюється)', async () => {
    for (const extra of [['--resize'], ['--resize', '--confirm-resize'], ['--confirm-resize']]) {
      const w = world();
      expect(await main(oneNode(...extra), w.deps), extra.join(' ')).toBe(2);
      expect(w.transports()).toBe(0);
      expect(w.err.join('\n')).toMatch(/розмір вузла/);
    }
  });

  it('недопустимі поєднання й значення — код 2 без з’єднання', async () => {
    for (const argv of [
      ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'two-nodes', '--midnight', MIDNIGHT],
      oneNode('--second', SECOND),
      ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'one-node'],
      ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'both', '--midnight', MIDNIGHT],
      ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'one-node', '--midnight', '2026-12-31T10:07:00Z'],
      ['scheduler-drill', '--env', 'rehearsal', '--target', MAIN, '--mode', 'two-nodes', '--second', MAIN, '--midnight', MIDNIGHT],
    ]) {
      const w = world({ mode: 'two-nodes', privateDbOpen: true });
      expect(await main(argv, w.deps), argv.join(' ')).toBe(2);
      expect(w.transports(), argv.join(' ')).toBe(0);
    }
  });

  it('один вузол: пам’яті бракує — відмова з кількістю МБ, жодного виклику Compose (AC-71)', async () => {
    const w = world({ memKb: 500 * 1024 });
    expect(await main(oneNode(), w.deps)).toBe(2);
    expect(w.err.join('\n')).toContain('бракує 268 МБ');
    expect(w.calls.filter((c) => c.argv[1] === 'compose')).toEqual([]);
    expect(w.changes()).toEqual([]);
    expect(w.journal().at(-1)).toMatchObject({ step: 'precheck', result: 'refused' });
  });

  it('два вузли: private-db не відкрито або другий нездоровий — відмова без змін', async () => {
    for (const o of [{ privateDbOpen: false }, { privateDbOpen: true, secondHealthy: false }]) {
      const w = world({ mode: 'two-nodes', holder: 'main', ...o });
      expect(await main(twoNodes(), w.deps), JSON.stringify(o)).toBe(2);
      expect(w.changes()).toEqual([]);
      expect(w.vclock.virtual).toBe(false);
    }
  });
});

describe('scheduler-drill --mode one-node (AC-70)', () => {
  it('власник — основний: північ, зупинка, перехоплення, записи, відновлення; рядок DRILL', async () => {
    const w = world({ holder: 'main' });
    expect(await main(oneNode(), w.deps), w.err.join('\n')).toBe(0);
    expect(w.changes()).toEqual([
      'main: write compose.drill.yml',
      'main: up -d --no-deps server-drill',
      'main: clock restart-night',
      'main: clock set --at 2026-12-31T09:59:00Z',
      'main: clock speed 1',
      'main: kill -s SIGKILL server',
      'main: start server',
      'main: clock real',
      'main: rm -sf server-drill',
      'main: rm compose.drill.yml',
    ]);
    const d = drillOf(w.out);
    expect(d).not.toBeNull();
    expect(d?.duplicates).toBe(0);
    expect(d?.missed).toBe(0);
    // SIGKILL, не `stop`: благодатна зупинка звільнила б оренду (у фейку — миттєве перехоплення) і замір був би не той.
    expect(w.calls.some((c) => c.argv[1] === 'compose' && c.argv.includes('stop'))).toBe(false);
    expect(d?.takeover).toBeGreaterThanOrEqual(6000);
    expect(d?.takeover).toBeLessThanOrEqual(6700);
    expect(w.out.some((l) => l.startsWith('T2F_MEASURE {"metric":"lease-takeover-ms"'))).toBe(true);
    // Стан після: основний працює, годинник реальний, екземпляра навчання немає, файлу теж.
    expect(w.inst.main.running).toBe(true);
    expect(w.inst.drill.exists).toBe(false);
    expect(w.vclock.virtual).toBe(false);
    expect(w.files.size).toBe(0);
    const j = w.journal();
    expect(j.filter((r) => r.step === 'outage').map((r) => r.result)).toEqual(['started', 'ended']);
    expect(j.at(-1)).toMatchObject({ sub: 'scheduler-drill', mode: 'one-node', step: 'restore', result: 'ok', left: [] });
    // Зупинка — рівно у віртуальну північ (запас LEAD 60 с на швидкості 1).
    expect(j.find((r) => r.step === 'clock-set')).toMatchObject({ midnight: MIDNIGHT, moment: KEY, due: 2 });
  });

  it('власник — екземпляр навчання: зупиняється він, основний не чіпається, простою /api немає', async () => {
    const w = world({ holder: 'drill' });
    expect(await main(oneNode(), w.deps), w.err.join('\n')).toBe(0);
    const ch = w.changes();
    expect(ch).toContain('main: kill -s SIGKILL server-drill');
    expect(ch).not.toContain('main: kill -s SIGKILL server');
    expect(ch).not.toContain('main: start server');
    expect(ch.slice(-3)).toEqual(['main: clock real', 'main: rm -sf server-drill', 'main: rm compose.drill.yml']);
    expect(w.journal().some((r) => r.step === 'outage')).toBe(false);
  });

  it('дубль і пропуск — код 1, числа в рядку DRILL', async () => {
    const dup = world({ holder: 'main', duplicate: true });
    expect(await main(oneNode(), dup.deps)).toBe(1);
    expect(drillOf(dup.out)).toMatchObject({ duplicates: 1, missed: 0 });
    const miss = world({ holder: 'main', missAction: true });
    expect(await main(oneNode(), miss.deps)).toBe(1);
    expect(drillOf(miss.out)).toMatchObject({ duplicates: 0, missed: 1 });
    expect(miss.inst.main.running).toBe(true);
    expect(miss.vclock.virtual).toBe(false);
  });

  it('без переліку due — належним вважається хоча б один запис ключа моменту', async () => {
    const w = world({ holder: 'main', noDue: true });
    expect(await main(oneNode(), w.deps), w.err.join('\n')).toBe(0);
    expect(drillOf(w.out)).toMatchObject({ duplicates: 0, missed: 0 });
  });

  it('перехоплення довше 10 с — код 1, відновлення все одно', async () => {
    const w = world({ holder: 'main', takeoverDelay: 12_000 });
    expect(await main(oneNode(), w.deps)).toBe(1);
    expect(drillOf(w.out)?.takeover).toBeGreaterThan(10_000);
    expect(w.changes().slice(-4)).toEqual(['main: start server', 'main: clock real', 'main: rm -sf server-drill', 'main: rm compose.drill.yml']);
  });

  it.each([
    ['up', (/** @type {string} */ a) => / up -d --no-deps server-drill$/.test(a), { start: false, real: false }],
    ['restart-night', (/** @type {string} */ a) => a.endsWith('clock restart-night'), { start: false, real: true }],
    ['set', (/** @type {string} */ a) => a.includes('clock set --at'), { start: false, real: true }],
    ['kill', (/** @type {string} */ a) => / kill -s SIGKILL server$/.test(a), { start: true, real: true }],
    ['records', (/** @type {string} */ a) => a.includes('clock records'), { start: true, real: true }],
    ['takeover status', (/** @type {string} */ a) => a.includes('server-drill pnpm run clock status'), { start: true, real: true }],
  ])('збій на кроці %s — finally відновлює (start, clock real, прибирання) і код 1', async (_, failWhen, expect_) => {
    // До зупинки статус читається з основного; статус `server-drill` — лише під час перехоплення.
    const w = world({ holder: 'main', failWhen });
    expect(await main(oneNode(), w.deps)).toBe(1);
    const ch = w.changes();
    expect(ch.includes('main: start server'), 'start').toBe(expect_.start);
    expect(ch.includes('main: clock real'), 'clock real').toBe(expect_.real);
    expect(ch).toContain('main: rm -sf server-drill');
    expect(w.inst.main.running).toBe(true);
    expect(w.vclock.virtual).toBe(false);
    expect(w.inst.drill.exists).toBe(false);
    const j = w.journal();
    expect(j.some((r) => r.step === 'drill' && r.result === 'failed')).toBe(true);
    expect(j.at(-1)).toMatchObject({ step: 'restore', result: 'ok' });
  });

  it('публічний /api не відповідає після відновлення — код 1, у журналі що лишилося', async () => {
    const w = world({ holder: 'main', edgeDown: true });
    expect(await main(oneNode(), w.deps)).toBe(1);
    expect(w.err.join('\n')).toMatch(/лишилося: https:\/\/rehearsal\.time2fest\.com\/api\/health/);
    expect(w.journal().at(-1)).toMatchObject({ step: 'restore', result: 'failed', left: ['https://rehearsal.time2fest.com/api/health не відповідає 200'] });
  });
});

describe('scheduler-drill --mode two-nodes', () => {
  it('власник — другий: один перезапуск другого, далі основний зупиняється опівночі, другий перехоплює', async () => {
    const w = world({ mode: 'two-nodes', holder: 'second', privateDbOpen: true });
    expect(await main(twoNodes(), w.deps), w.err.join('\n')).toBe(0);
    expect(w.changes()).toEqual([
      'second: restart server',
      'main: clock restart-night',
      'main: clock set --at 2026-12-31T09:59:00Z',
      'main: clock speed 1',
      'main: kill -s SIGKILL server',
      'main: start server',
      'second: start server',
      'main: clock real',
    ]);
    expect(w.lease.holder).toBe('second');
    expect(drillOf(w.out)).toMatchObject({ duplicates: 0, missed: 0 });
    // Записи читаються з другого вузла (той, хто перехопив).
    expect(w.calls.some((c) => c.host === SECOND && c.argv.join(' ').includes('clock records --epoch 4'))).toBe(true);
    expect(w.journal().find((r) => r.step === 'result')).toMatchObject({ holder: 'main', by: 'second' });
  });

  it('власник — основний одразу: без перезапуску, на другому вузлі нічого не змінюється', async () => {
    const w = world({ mode: 'two-nodes', holder: 'main', privateDbOpen: true });
    expect(await main(twoNodes(), w.deps), w.err.join('\n')).toBe(0);
    expect(w.changes().filter((c) => c?.startsWith('second:'))).toEqual([]);
    expect(w.inst.second.running).toBe(true);
  });
});

describe('scheduler-drill: чисті функції', () => {
  it('пам’ять і північ поясу', () => {
    expect(parseMemAvailableMb('MemTotal: 1 kB\nMemAvailable:    786432 kB\n')).toBe(768);
    expect(parseMemAvailableMb('MemFree: 1 kB')).toBeNull();
    expect(memoryShortMb(768)).toBe(0);
    expect(memoryShortMb(700)).toBe(68);
    expect(isZoneMidnight('2026-12-31T10:00:00Z')).toBe(true);
    expect(isZoneMidnight('2026-12-31T18:15:00Z')).toBe(true); // +5:45
    expect(isZoneMidnight('2026-12-31T10:00:30Z')).toBe(false);
    expect(isZoneMidnight('2026-12-31T10:10:00Z')).toBe(false);
  });

  it('статус: конверт value, власник, епохи; хост власника', () => {
    const s = parseStatus({ ok: true, value: { lease: { holder: 'abc123:7:ff', epoch: 4, expiresInMs: 100 }, runEpoch: 2, now: MIDNIGHT, speed: 1, frozen: false, nextMoment: { key: KEY, at: MIDNIGHT_MS, due: DUE } } });
    expect(s).toEqual({ holder: 'abc123:7:ff', epoch: 4, runEpoch: 2, nowMs: MIDNIGHT_MS, speed: 1, frozen: false, next: { key: KEY, atMs: MIDNIGHT_MS, due: DUE } });
    expect(parseStatus({ lease: null, runEpoch: 1, now: 5, speed: 0, frozen: true, nextMoment: null })).toMatchObject({ holder: null, epoch: null, frozen: true, next: null });
    expect(holderHost('3f2a9c1b7d0e:1:0badc0de')).toBe('3f2a9c1b7d0e');
  });

  it('записи: пари з груп, дублі й пропуски', () => {
    const pairs = recordPairs({ epoch: 4, records: [{ keys: [KEY, 'x'], action: 'a' }, { keys: [KEY], action: 'a' }, { key: 'y', action: 'b' }] });
    expect(pairs).toEqual([{ action: 'a', key: KEY }, { action: 'a', key: 'x' }, { action: 'a', key: KEY }, { action: 'b', key: 'y' }]);
    expect(tallyRecords(/** @type {any} */ (pairs), { key: KEY, due: [{ action: 'a', key: KEY }, { action: 'c', key: KEY }] })).toEqual({ duplicates: 1, missed: 1 });
    expect(tallyRecords([], { key: KEY, due: null })).toEqual({ duplicates: 0, missed: 1 });
    expect(recordPairs({ nope: 1 })).toBeNull();
  });

  it('заміри з підставних міток: середина виклику мінус зупинка / північ', () => {
    const r = measure({ stopAt: 10_000, takeover: { start: 16_000, end: 16_400 }, midnightAt: 10_000, records: { start: 17_000, end: 17_600 } });
    expect(r).toEqual({ takeoverMs: 6_200, lateMs: 7_300 });
    expect(measure({ stopAt: 5_000, takeover: { start: 4_000, end: 4_100 }, midnightAt: 5_000, records: { start: 4_000, end: 4_000 } })).toEqual({ takeoverMs: 0, lateMs: 0 });
    expect(realTimeOf(MIDNIGHT_MS, { nowMs: MIDNIGHT_MS - 60_000, speed: 1 }, 1_000)).toBe(61_000);
    expect(realTimeOf(MIDNIGHT_MS, { nowMs: MIDNIGHT_MS - 60_000, speed: 60 }, 1_000)).toBe(2_000);
    expect(drillLine({ takeoverMs: 6200, lateMs: 7300, duplicates: 0, missed: 0 })).toBe('DRILL takeover_ms=6200 late_ms=7300 duplicates=0 missed=0');
  });
});
