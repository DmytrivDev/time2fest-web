// @ts-check
// O·P18a: `ops private-db open|close` і `ops server2 up|down` на підставних вузлах (стан у пам’яті) і фейковому
// провайдері; похідний server.env другого вузла; проксі приватного доступу. Мережі й справжнього SSH немає.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createFakeProvider, FAKE_ENV_SIZES } from '../lib/capacity/fake.mjs';
import { checkPeer, inNet, isPrivateV4, listenersOn, pickVpcAddress } from '../lib/privateDb.mjs';
import { deriveServer2Env, replaceHost } from '../lib/server2.mjs';
import { parseRoutes, startProxy } from '../node/private-db-proxy.mjs';
import { main } from '../ops.mjs';
import { createFakeNodes, MAIN_IP_OUT } from './support/fakeNode.mjs';
import { FAKE_TARGET } from './support/fakeTarget.mjs';

const SHA = 'c'.repeat(40);
const MAIN_HOST = '203.0.113.10';
const NODE_DIR = '/srv/t2f/rehearsal';
const M = 't2f-managed';
const E = 't2f-env-rehearsal';
// Підставні значення для тесту редагування (не справжні секрети).
const PG_PASS = 'pg-fake-password-1234'; // check-secrets: allow test fake
const REDIS_PASS = 'redis-fake-password-5678'; // check-secrets: allow test fake
const API_KEY = 'centrifugo-fake-api-key-abcdefghijklmnop'; // check-secrets: allow test fake
const SERVER_ENV = [
  '# коментар лишається',
  `DATABASE_URI=postgres://t2f:${PG_PASS}@postgres:5432/t2f_rehearsal`,
  `REDIS_URL=redis://:${REDIS_PASS}@redis:6379/0`,
  'T2F_REDIS_PREFIX=t2f_rehearsal',
  'T2F_CENTRIFUGO_URL=http://centrifugo:9000',
  `T2F_CENTRIFUGO_API_KEY=${API_KEY}`,
  'T2F_R2_ENDPOINT=https://example.r2.cloudflarestorage.com',
  '',
].join('\n');

/** @type {string[]} */
const temps = [];
afterEach(() => {
  for (const d of temps.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * @param {{ server2?: boolean, mainNode?: Parameters<typeof createFakeNodes>[0][string], current?: boolean }} [o]
 */
function world(o = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-server2-'));
  temps.push(dir);
  fs.mkdirSync(path.join(dir, 'rehearsal'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'rehearsal', 'server.env'), SERVER_ENV);
  const seed = [{ name: 't2f-rehearsal-main', size: 's-1vcpu-2gb', tags: [M, E, 't2f-role-main'], publicIp: MAIN_HOST, privateIp: '10.114.0.2' }];
  if (o.server2 !== false) seed.push({ name: 't2f-rehearsal-server2', size: 's-1vcpu-2gb', tags: [M, E, 't2f-role-server2'], publicIp: '203.0.113.20', privateIp: '10.114.0.3' });
  const fake = createFakeProvider({ nodes: seed });
  /** @type {Record<string, string>} */
  const files = o.current === false ? {} : { [`${NODE_DIR}/current.env`]: `T2F_ENV=rehearsal\nT2F_SERVER_SHA=${SHA}\n` };
  const nodes = createFakeNodes({
    [MAIN_HOST]: { files, ...o.mainNode },
    '203.0.113.20': { ipOut: '' },
  });
  /** @type {{ step: string, host?: string }[]} */
  const imageCalls = [];
  const image = {
    buildImage: async () => (imageCalls.push({ step: 'build' }), { code: 0, skipped: true }),
    deliver: async (/** @type {{ describe: string }} */ t) => (imageCalls.push({ step: 'deliver', host: t.describe }), { code: 0, skipped: false }),
    present: async () => true,
    retain: async () => ({ removed: [], failed: [] }),
  };
  /** @type {string[]} */
  let lines = [];
  let t = 0;
  const deps = /** @type {any} */ ({
    out: (/** @type {string} */ l) => lines.push(l),
    env: {},
    exec: {
      run: async () => ({ code: 0, stdout: '', stderr: '' }),
      localTransport: () => {
        throw new Error('немає локального транспорту');
      },
      sshTransport: () => {
        throw new Error('немає справжнього SSH');
      },
    },
    now: () => new Date('2026-11-18T10:00:00Z'),
    provider: async () => ({ name: 'fake', provider: fake.provider, envSizes: FAKE_ENV_SIZES }),
    paths: { stateRoot: dir },
    transport: nodes.transportPort,
    image: () => image,
    clock: { now: () => t, sleep: async (/** @type {number} */ ms) => void (t += ms) },
    ...FAKE_TARGET,
  });
  return {
    dir,
    fake,
    nodes,
    imageCalls,
    main: () => /** @type {import('./support/fakeNode.mjs').NodeState} */ (nodes.state[MAIN_HOST]),
    node2: () => /** @type {import('./support/fakeNode.mjs').NodeState} */ (nodes.state['203.0.113.20']),
    journal: () =>
      fs
        .readFileSync(path.join(dir, 'rehearsal', 'server2.jsonl'), 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
    /** @param {...string} argv */
    async run(...argv) {
      lines = [];
      const code = await main(argv, deps);
      return { code, text: lines.join('\n') };
    },
  };
}

const open = (/** @type {ReturnType<typeof world>} */ w, peer = '10.114.0.3', env = 'rehearsal') => w.run('private-db', '--env', env, '--target', MAIN_HOST, 'open', '--peer', peer);
const close = (/** @type {ReturnType<typeof world>} */ w) => w.run('private-db', '--env', 'rehearsal', '--target', MAIN_HOST, 'close');

describe('адреси VPC (чисті функції)', () => {
  it('VPC — приватна адреса не на інтерфейсі маршруту за замовчуванням (якірна 10.x на eth0 і docker0 відсіюються)', () => {
    const r = pickVpcAddress(MAIN_IP_OUT);
    expect(r).toEqual({ ok: true, vpc: { iface: 'eth1', address: '10.114.0.2', prefix: 20 } });
    expect(pickVpcAddress('---\ndefault via 1.2.3.4 dev eth0\n').ok).toBe(false);
  });

  it('RFC 1918 і межі мережі', () => {
    expect(['10.0.0.1', '172.16.5.4', '172.31.255.1', '192.168.1.1'].every(isPrivateV4)).toBe(true);
    expect(['172.32.0.1', '8.8.8.8', '178.20.157.85', '100.64.0.1', 'x'].some(isPrivateV4)).toBe(false);
    expect(inNet('10.114.15.254', '10.114.0.2', 20)).toBe(true);
    expect(inNet('10.114.16.1', '10.114.0.2', 20)).toBe(false);
    const vpc = { iface: 'eth1', address: '10.114.0.2', prefix: 20 };
    expect(checkPeer('10.114.0.3', vpc).ok).toBe(true);
    expect(checkPeer('10.114.0.2', vpc).ok).toBe(false);
    expect(checkPeer('10.114.15.255', vpc).ok).toBe(false);
    expect(checkPeer('10.19.0.9', vpc).ok).toBe(false);
    expect(checkPeer('203.0.113.20', vpc).ok).toBe(false);
  });

  it('слухачі з ss -Htln', () => {
    const ss = 'LISTEN 0 4096 10.114.0.2:5432 0.0.0.0:*\nLISTEN 0 4096 [::]:6379 [::]:*\nLISTEN 0 4096 0.0.0.0:22 0.0.0.0:*\n';
    expect(listenersOn(ss, [5432, 6379])).toEqual([
      { address: '10.114.0.2', port: 5432 },
      { address: '::', port: 6379 },
    ]);
  });
});

describe('private-db: відмови до будь-якої зміни', () => {
  it('публічна адреса --peer — 2 ще до входу на вузол', async () => {
    const w = world();
    const r = await open(w, '203.0.113.20');
    expect(r.code).toBe(2);
    expect(r.text).toContain('не приватна адреса');
    expect(w.nodes.calls).toEqual([]);
  });

  it('production — 2 (лише rehearsal)', async () => {
    const w = world();
    expect((await open(w, '10.114.0.3', 'production')).code).toBe(2);
    expect(w.nodes.calls).toEqual([]);
  });

  it('приватна, але поза VPC вузла (з вузла, не з аргументу) — 2 без змін', async () => {
    const w = world();
    const r = await open(w, '10.19.0.9');
    expect(r.code).toBe(2);
    expect(r.text).toContain('поза мережею VPC');
    expect(w.nodes.changing()).toEqual([]);
  });

  it('немає current.env, немає мережі backend, порт уже зайнятий — 2 без змін', async () => {
    const a = world({ current: false });
    expect((await open(a)).code).toBe(2);
    const b = world({ mainNode: { backend: false } });
    expect((await open(b)).code).toBe(2);
    const c = world();
    c.main().listeners.push({ address: '0.0.0.0', port: 5432, owner: 'x' });
    const r = await open(c);
    expect(r.code).toBe(2);
    expect(r.text).toContain('вже слухаються');
    expect([...a.nodes.changing(), ...b.nodes.changing(), ...c.nodes.changing()]).toEqual([]);
  });

  it('уже відкрито для іншої адреси — 2', async () => {
    const w = world();
    expect((await open(w)).code).toBe(0);
    const before = w.nodes.changing().length;
    const r = await open(w, '10.114.0.4');
    expect(r.code).toBe(2);
    expect(w.nodes.changing().length).toBe(before);
  });
});

describe('private-db open → close', () => {
  it('порти лише на приватній адресі; postgres і redis не чіпаються; close повертає як було й ідемпотентний', async () => {
    const w = world();
    const filesBefore = [...w.main().files.keys()].sort();
    const o = await open(w);
    expect(o.code).toBe(0);
    expect(w.main().listeners.map((l) => `${l.address}:${l.port}`)).toEqual(['10.114.0.2:5432', '10.114.0.2:6379']);
    expect(w.main().files.get(`${NODE_DIR}/private-db.env`)).toContain('T2F_PRIVATE_DB_PEER=10.114.0.3');
    expect(o.text).toContain('простою немає');
    expect(o.text).toContain('nc -vz');
    // Жодної команди проєкту основного вузла (t2f-rehearsal): postgres/redis/server не перестворюються.
    const composeCalls = w.nodes.calls.filter((c) => c.argv[1] === 'compose');
    expect(composeCalls.every((c) => c.argv[c.argv.indexOf('-p') + 1] === 't2f-rehearsal-private-db')).toBe(true);
    expect(w.nodes.calls.some((c) => /iptables|ufw/.test(c.argv.join(' ')))).toBe(false);

    // Повтор open з тим самим --peer — без змін.
    const changed = w.nodes.changing().length;
    expect((await open(w)).code).toBe(0);
    expect(w.nodes.changing().length).toBe(changed);

    const c = await close(w);
    expect(c.code).toBe(0);
    expect(w.main().listeners).toEqual([]);
    expect([...w.main().containers.values()].flat()).toEqual([]);
    expect([...w.main().networks.values()].flat()).toEqual([]);
    expect([...w.main().files.keys()].sort()).toEqual(filesBefore);
    // Ідемпотентне: другий close — 0, нічого не прибирає.
    const again = await close(w);
    expect(again.code).toBe(0);
    expect(again.text).toContain('контейнерів 0, мереж 0');

    const steps = w.journal().map((r) => `${r.sub}:${r.action}:${r.step}:${r.result}`);
    expect(steps).toEqual([
      'private-db:open:files:ok',
      'private-db:open:up:ok',
      'private-db:open:verify:ok',
      'private-db:close:down:ok',
      'private-db:close:verify:ok',
      'private-db:close:down:ok',
      'private-db:close:verify:ok',
    ]);
    expect(w.journal().find((r) => r.step === 'up')?.outage).toMatch(/^none/);
  });

  it('Docker опублікував порт не лише на приватній адресі — 1 і автоматичне повернення', async () => {
    const w = world({ mainNode: { publishOn: '0.0.0.0' } });
    const r = await open(w);
    expect(r.code).toBe(1);
    expect(r.text).toContain('повернуто як було');
    expect(w.main().listeners).toEqual([]);
    expect([...w.main().files.keys()]).toEqual([`${NODE_DIR}/current.env`]);
  });
});

describe('server2: похідний server.env', () => {
  it('міняються лише хости трьох змінних; решта рядків як були', () => {
    const r = deriveServer2Env(SERVER_ENV, '10.114.0.2');
    if (!r.ok) throw new Error(r.message);
    expect(r.replaced).toEqual(['DATABASE_URI', 'REDIS_URL', 'T2F_CENTRIFUGO_URL']);
    expect(r.text).toContain(`DATABASE_URI=postgres://t2f:${PG_PASS}@10.114.0.2:5432/t2f_rehearsal`);
    expect(r.text).toContain(`REDIS_URL=redis://:${REDIS_PASS}@10.114.0.2:6379/0`);
    expect(r.text).toContain('T2F_CENTRIFUGO_URL=http://10.114.0.2:9000');
    const keep = (/** @type {string} */ s) => s.split('\n').filter((l) => !/^(DATABASE_URI|REDIS_URL|T2F_CENTRIFUGO_URL)=/.test(l));
    expect(keep(r.text)).toEqual(keep(SERVER_ENV));
  });

  it('неочікуваний хост чи відсутня змінна — відмова, у повідомленні лише назва змінної', () => {
    const bad = SERVER_ENV.replace('@postgres:5432', '@db.example.com:5432');
    const r = deriveServer2Env(bad, '10.114.0.2');
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('DATABASE_URI');
      expect(r.message).not.toContain(PG_PASS);
      expect(r.message).not.toContain('db.example.com');
    }
    expect(deriveServer2Env(SERVER_ENV.replace(/^REDIS_URL=.*$/m, ''), '10.114.0.2').ok).toBe(false);
    expect(deriveServer2Env(SERVER_ENV, '203.0.113.10').ok).toBe(false);
    expect(replaceHost('http://centrifugo:9000', 'centrifugo', '10.0.0.1')).toBe('http://10.0.0.1:9000');
    expect(replaceHost('http://centrifugo.evil:9000', 'centrifugo', '10.0.0.1')).toBe(null);
  });
});

describe('server2 up → down', () => {
  it('без відкритого доступу до бази — 2, на другий вузол нічого не йде', async () => {
    const w = world();
    const r = await w.run('server2', '--env', 'rehearsal', '--target', MAIN_HOST, 'up');
    expect(r.code).toBe(2);
    expect(r.text).toContain('private-db');
    expect(w.nodes.calls.filter((c) => c.host === '203.0.113.20')).toEqual([]);
    expect(w.imageCalls).toEqual([]);
  });

  it('немає вузла другого сервера — 2; production — 2', async () => {
    const w = world({ server2: false });
    expect((await w.run('server2', '--env', 'rehearsal', '--target', MAIN_HOST, 'up')).code).toBe(2);
    expect((await w.run('server2', '--env', 'production', '--target', MAIN_HOST, 'up')).code).toBe(2);
    expect(w.nodes.calls).toEqual([]);
  });

  it('той самий образ, похідний server.env, без міграцій і без змін на основному; значення не друкуються навіть замасковано', async () => {
    const w = world();
    expect((await open(w)).code).toBe(0);
    const mainChangesBefore = w.nodes.changing().filter((c) => c.host === MAIN_HOST).length;
    const r = await w.run('server2', '--env', 'rehearsal', '--target', MAIN_HOST, 'up');
    expect(r.code).toBe(0);
    expect(w.imageCalls).toEqual([{ step: 'build' }, { step: 'deliver', host: 'ssh:203.0.113.20' }]);
    const n2 = w.node2();
    expect(n2.files.get('/srv/t2f/rehearsal-server2/next.env')).toContain(`T2F_SERVER_SHA=${SHA}`);
    expect(n2.files.get('/srv/t2f/rehearsal-server2/compose.yml')).toBe(fs.readFileSync(new URL('../node/compose.server2.yml', import.meta.url), 'utf8'));
    expect(n2.files.get('/srv/t2f/rehearsal-server2/server.env')).toContain('@10.114.0.2:5432/');
    expect(fs.readFileSync(path.join(w.dir, 'rehearsal', 'server2.env'), 'utf8')).toContain('http://10.114.0.2:9000');
    // Основний вузол — лише читання; міграцій ніде немає.
    expect(w.nodes.changing().filter((c) => c.host === MAIN_HOST).length).toBe(mainChangesBefore);
    expect(w.nodes.calls.some((c) => c.argv.includes('migrate'))).toBe(false);
    // Жодне значення не дійшло до виводу — ні відкрито, ні як *** (редактору нічого було маскувати).
    for (const v of [PG_PASS, REDIS_PASS, API_KEY, '***']) expect(r.text).not.toContain(v);
    expect(r.text).toContain('DATABASE_URI, REDIS_URL, T2F_CENTRIFUGO_URL');

    const d = await w.run('server2', '--env', 'rehearsal', '--target', MAIN_HOST, 'down');
    expect(d.code).toBe(0);
    expect([...n2.containers.values()].flat()).toEqual([]);
    expect(n2.files.has('/srv/t2f/rehearsal-server2/server.env')).toBe(false);
    expect(fs.existsSync(path.join(w.dir, 'rehearsal', 'server2.env'))).toBe(false);
    expect((await w.run('server2', '--env', 'rehearsal', '--target', MAIN_HOST, 'down')).code).toBe(0);
    expect(w.journal().filter((x) => x.sub === 'server2').map((x) => `${x.action}:${x.step}:${x.result}`)).toEqual([
      'up:build:ok',
      'up:deliver:ok',
      'up:files:ok',
      'up:start:ok',
      'up:health:ok',
      'down:down:ok',
      'down:down:ok',
    ]);
  });
});

describe('проксі private-db', () => {
  it('маршрути розбираються суворо', () => {
    expect(parseRoutes('5432=postgres:5432,6379=redis:6379')).toEqual([
      { listen: 5432, host: 'postgres', port: 5432 },
      { listen: 6379, host: 'redis', port: 6379 },
    ]);
    expect(() => parseRoutes('5432=postgres')).toThrow();
    expect(() => parseRoutes('')).toThrow();
  });

  it('пропускає лише --peer; іншу адресу закриває, не з’єднуючись далі', async () => {
    let upstreamHits = 0;
    const upstream = net.createServer((s) => {
      upstreamHits += 1;
      s.end('pong');
    });
    await new Promise((r) => upstream.listen(0, '127.0.0.1', () => r(undefined)));
    const port = /** @type {net.AddressInfo} */ (upstream.address()).port;
    /** @param {string} peer */
    const roundTrip = async (peer) => {
      /** @type {string[]} */
      const log = [];
      const proxy = startProxy({ peer, routes: [{ listen: 0, host: '127.0.0.1', port }], listenHost: '127.0.0.1', log: (l) => log.push(l) });
      const srv = /** @type {net.Server} */ (proxy.servers[0]);
      await new Promise((r) => (srv.listening ? r(undefined) : srv.once('listening', () => r(undefined))));
      const lp = /** @type {net.AddressInfo} */ (srv.address()).port;
      const got = await new Promise((resolve) => {
        let data = '';
        const c = net.connect(lp, '127.0.0.1');
        c.on('data', (d) => (data += d));
        c.on('close', () => resolve(data));
        c.on('error', () => resolve(data));
      });
      await proxy.close();
      return { got, log };
    };
    const ok = await roundTrip('127.0.0.1');
    expect(ok.got).toBe('pong');
    const denied = await roundTrip('10.114.0.3');
    expect(denied.got).toBe('');
    expect(denied.log.join('\n')).toContain('відмова 127.0.0.1');
    expect(upstreamHits).toBe(1);
    await new Promise((r) => upstream.close(() => r(undefined)));
  });
});
