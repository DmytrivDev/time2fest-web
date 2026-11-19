// @ts-check
// `ops private-db --env rehearsal --target <основний вузол> open --peer <приватна IPv4 другого вузла> | close`
// (O·P18a, навчання «два сервери»). Тимчасовий доступ другого вузла до Postgres і Redis основного: окремий проєкт
// Compose з проксі (`node/compose.private-db.yml`), порти якого Docker публікує лише на приватній адресі VPC основного
// вузла; проксі приймає з’єднання лише від `--peer`. Postgres і Redis не перезапускаються (простою немає), а `close`
// прибирає проєкт проксі, його мережу й файли — стан вузла як до `open`. Адреса VPC читається з вузла, а не з аргументу.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався (після невдалого `open` виконується `close`).
import fs from 'node:fs';
import path from 'node:path';
import { isIPv4 } from 'node:net';
import { ENVS } from './config.mjs';
import { messageOf, resolveSite } from './common.mjs';
import { acquireNodeLock } from './lock.mjs';
import { createNode } from './node.mjs';
import { getVar } from './secrets/envFile.mjs';

export const PRIVATE_DB_COMPOSE = 'compose.private-db.yml';
export const PRIVATE_DB_ENV = 'private-db.env';
export const PRIVATE_DB_PROXY = 'private-db-proxy.mjs';
export const PRIVATE_DB_SERVICE = 'private-db';
/** Порти, що відкриваються другому вузлу: Postgres і Redis. Centrifugo API (9000) — ні. */
export const PRIVATE_DB_PORTS = [5432, 6379];
/** Журнал навчання на машині оператора: `.local/<env>/server2.jsonl` (і `private-db`, і `server2`). */
export const DRILL_JOURNAL = 'server2.jsonl';
/** Адреса VPC і маршрут за замовчуванням (інтерфейс VPC — той, що НЕ несе маршруту за замовчуванням). */
export const VPC_SCRIPT = 'ip -4 -o addr show scope global; echo ---; ip -4 route show default';

const TIMEOUT_MS = 60_000;
const UP_TIMEOUT_MS = 5 * 60_000;
const RE_ID = /^[0-9a-f]{12,64}$/;

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {{ iface: string, address: string, prefix: number }} Vpc
 */

/** @param {string} env */
export const privateDbProject = (env) => `t2f-${env}-private-db`;

// ---------- адреси IPv4 (чисті функції) ----------

/** @param {string} a */
const toInt = (a) => a.split('.').reduce((n, o) => n * 256 + Number(o), 0);
/** @param {number} prefix */
const maskOf = (prefix) => (prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0);

/**
 * Чи `a` у мережі `base/prefix`.
 * @param {string} a
 * @param {string} base
 * @param {number} prefix
 */
export function inNet(a, base, prefix) {
  if (!isIPv4(a) || !isIPv4(base) || !(prefix >= 0 && prefix <= 32)) return false;
  const m = maskOf(prefix);
  return ((toInt(a) & m) >>> 0) === ((toInt(base) & m) >>> 0);
}

/** RFC 1918: 10/8, 172.16/12, 192.168/16. @param {string} a */
export function isPrivateV4(a) {
  return isIPv4(a) && (inNet(a, '10.0.0.0', 8) || inNet(a, '172.16.0.0', 12) || inNet(a, '192.168.0.0', 16));
}

/**
 * Адреса VPC вузла з виводу `VPC_SCRIPT`: приватна (RFC 1918) адреса на інтерфейсі, що не несе маршруту за
 * замовчуванням і не належить Docker. У поточного провайдера це eth1 (якірна 10.x на eth0 відсіюється маршрутом).
 * @param {string} stdout
 * @returns {{ ok: true, vpc: Vpc } | { ok: false, message: string }}
 */
export function pickVpcAddress(stdout) {
  const [addrs = '', routes = ''] = String(stdout).split(/^---\s*$/m);
  const defaultDevs = new Set([...routes.matchAll(/\bdev\s+(\S+)/g)].map((m) => m[1]));
  /** @type {Vpc[]} */
  const found = [];
  for (const line of addrs.split(/\r?\n/)) {
    const m = line.match(/^\d+:\s+(\S+)\s+inet\s+(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})\b/);
    if (!m) continue;
    const iface = m[1].replace(/@.*$/, '');
    if (/^(?:lo|docker\d*|br-|veth|virbr)/.test(iface) || defaultDevs.has(iface)) continue;
    if (!isPrivateV4(m[2])) continue;
    found.push({ iface, address: m[2], prefix: Number(m[3]) });
  }
  if (found.length !== 1) {
    return { ok: false, message: found.length ? `на вузлі ${found.length} приватні адреси поза маршрутом за замовчуванням (${found.map((v) => v.iface).join(', ')}): VPC неоднозначна` : 'на вузлі немає інтерфейсу VPC (приватна адреса поза маршрутом за замовчуванням)' };
  }
  return { ok: true, vpc: /** @type {Vpc} */ (found[0]) };
}

/**
 * Адреса другого вузла: IPv4, RFC 1918, у мережі VPC основного, не адреса самого вузла, не мережа й не broadcast.
 * @param {string} peer
 * @param {Vpc} vpc
 * @returns {{ ok: true } | { ok: false, message: string }}
 */
export function checkPeer(peer, vpc) {
  if (!isPrivateV4(peer)) return { ok: false, message: `--peer ${isIPv4(peer) ? peer : ''}: не приватна адреса (RFC 1918) — публічну не відкриваю` };
  if (!inNet(peer, vpc.address, vpc.prefix)) return { ok: false, message: `--peer ${peer}: поза мережею VPC вузла ${vpc.address}/${vpc.prefix} (${vpc.iface})` };
  if (peer === vpc.address) return { ok: false, message: `--peer ${peer}: це адреса самого основного вузла` };
  const m = maskOf(vpc.prefix);
  const host = (toInt(peer) & ~m) >>> 0;
  if (vpc.prefix < 31 && (host === 0 || host === (~m >>> 0))) return { ok: false, message: `--peer ${peer}: адреса мережі чи broadcast` };
  return { ok: true };
}

/**
 * Слухачі TCP з виводу `ss -Htln` на заданих портах.
 * @param {string} stdout
 * @param {number[]} ports
 * @returns {{ address: string, port: number }[]}
 */
export function listenersOn(stdout, ports) {
  /** @type {{ address: string, port: number }[]} */
  const out = [];
  for (const line of String(stdout).split(/\r?\n/)) {
    const cols = line.trim().split(/\s+/);
    const local = cols[3];
    if (!local) continue;
    const i = local.lastIndexOf(':');
    const port = Number(local.slice(i + 1));
    if (!ports.includes(port)) continue;
    const address = local.slice(0, i).replace(/^\[|\]$/g, '').replace(/%.*$/, '');
    out.push({ address, port });
  }
  return out;
}

// ---------- журнал навчання (локально, як журнал потужності) ----------

/**
 * @param {OpsContext} ctx
 * @param {string} env
 * @param {Record<string, unknown>} base
 */
export function drillJournal(ctx, env, base) {
  const file = path.join(ctx.paths.stateRoot, env, DRILL_JOURNAL);
  return {
    file,
    /** @param {Record<string, unknown>} rec */
    append(rec) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.appendFileSync(file, `${JSON.stringify({ at: ctx.now().toISOString(), env, ...base, ...rec })}\n`);
    },
  };
}

// ---------- віддалені команди ----------

/**
 * @param {Transport} t
 * @param {string[]} argv
 * @param {{ input?: string, timeoutMs?: number }} [o]
 */
const remote = (t, argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? TIMEOUT_MS, ...(o.input !== undefined ? { input: o.input } : {}) });

/** Компоненти виводу ідентифікаторів Docker (`-q`). @param {string} stdout */
const idsOf = (stdout) => String(stdout).split(/\s+/).filter((s) => RE_ID.test(s));

/**
 * Читання адреси VPC вузла.
 * @param {Transport} t
 * @returns {Promise<{ ok: true, vpc: Vpc } | { ok: false, message: string }>}
 */
export async function readVpc(t) {
  const r = await remote(t, ['sh', '-c', VPC_SCRIPT]);
  if (r.code !== 0) return { ok: false, message: `адреси вузла не прочитано (код ${r.code})` };
  return pickVpcAddress(r.stdout);
}

/**
 * Контейнери (усі, і зупинені) проєкту проксі.
 * @param {Transport} t
 * @param {string} env
 */
export async function proxyContainers(t, env) {
  const r = await remote(t, ['docker', 'ps', '-aq', '--filter', `label=com.docker.compose.project=${privateDbProject(env)}`]);
  if (r.code !== 0) throw new Error(`docker ps завершився з кодом ${r.code}`);
  return idsOf(r.stdout);
}

/**
 * Відкрите зараз: адреса другого вузла з `private-db.env` на вузлі (`null` — файлу чи змінної немає).
 * @param {Transport} t
 * @param {string} nodeDir
 */
export async function openPeer(t, nodeDir) {
  const r = await remote(t, ['sh', '-c', 'test ! -e "$1" || cat -- "$1"', '_', path.posix.join(nodeDir, PRIVATE_DB_ENV)]);
  if (r.code !== 0) throw new Error(`${PRIVATE_DB_ENV}: читання завершилося з кодом ${r.code}`);
  return getVar(r.stdout, 'T2F_PRIVATE_DB_PEER') || null;
}

/**
 * Перевірка з вузла: порти слухаються лише на приватній адресі (`open`) або не слухаються зовсім (`close`).
 * @param {Transport} t
 * @param {{ env: string, nodeDir: string, privateAddr: string | null }} o `privateAddr: null` — очікується «закрито»
 * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
 */
export async function verifyListeners(t, o) {
  const ss = await remote(t, ['ss', '-Htln']);
  if (ss.code !== 0) return { ok: false, message: `ss завершився з кодом ${ss.code}` };
  const seen = listenersOn(ss.stdout, PRIVATE_DB_PORTS);
  if (o.privateAddr === null) {
    return seen.length ? { ok: false, message: `порти досі слухаються: ${seen.map((l) => `${l.address}:${l.port}`).join(', ')}` } : { ok: true };
  }
  const stray = seen.filter((l) => l.address !== o.privateAddr);
  if (stray.length) return { ok: false, message: `порт слухається не лише на ${o.privateAddr}: ${stray.map((l) => `${l.address}:${l.port}`).join(', ')}` };
  for (const port of PRIVATE_DB_PORTS) {
    const r = await remote(t, [...composeOf(o.env, o.nodeDir), 'port', PRIVATE_DB_SERVICE, String(port)]);
    const published = r.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (r.code !== 0 || published.length === 0 || published.some((p) => p !== `${o.privateAddr}:${port}`)) {
      return { ok: false, message: `Docker публікує ${port} не лише на ${o.privateAddr}: ${published.join(', ') || `код ${r.code}`}` };
    }
  }
  return { ok: true };
}

/** @param {string} env @param {string} nodeDir */
const composeOf = (env, nodeDir) => [
  'docker', 'compose', '-p', privateDbProject(env),
  '-f', path.posix.join(nodeDir, PRIVATE_DB_COMPOSE),
  '--env-file', path.posix.join(nodeDir, PRIVATE_DB_ENV),
];

/**
 * Прибирання проєкту проксі (контейнери, його мережі, файли). Кожна частина спершу дивиться, чи є що прибирати.
 * @param {Transport} t
 * @param {string} env
 * @param {string} nodeDir
 */
async function closeSteps(t, env, nodeDir) {
  const ids = await proxyContainers(t, env);
  if (ids.length) {
    const r = await remote(t, ['docker', 'rm', '-f', ...ids], { timeoutMs: UP_TIMEOUT_MS });
    if (r.code !== 0) throw new Error(`docker rm завершився з кодом ${r.code}`);
  }
  const nets = await remote(t, ['docker', 'network', 'ls', '-q', '--filter', `label=com.docker.compose.project=${privateDbProject(env)}`]);
  if (nets.code !== 0) throw new Error(`docker network ls завершився з кодом ${nets.code}`);
  const netIds = idsOf(nets.stdout);
  if (netIds.length) {
    const r = await remote(t, ['docker', 'network', 'rm', ...netIds]);
    if (r.code !== 0) throw new Error(`docker network rm завершився з кодом ${r.code}`);
  }
  const rm = await remote(t, ['sh', '-c', 'cd -- "$1" && rm -f -- "$2" "$3" "$4"', '_', nodeDir, PRIVATE_DB_COMPOSE, PRIVATE_DB_ENV, PRIVATE_DB_PROXY]);
  if (rm.code !== 0) throw new Error(`файли проксі не прибрано (код ${rm.code})`);
  return { containers: ids.length, networks: netIds.length };
}

/**
 * Атомарний запис файлу у каталозі вузла.
 * @param {Transport} t
 * @param {string} file
 * @param {string} text
 * @param {'022' | '077'} umask
 */
async function writeRemote(t, file, text, umask) {
  const r = await remote(t, ['sh', '-c', `umask ${umask} && cat > "$1.tmp" && mv "$1.tmp" "$1"`, '_', file], { input: text });
  if (r.code !== 0) throw new Error(`${path.posix.basename(file)}: запис завершився з кодом ${r.code}`);
}

// ---------- підкоманда ----------

/**
 * `ops private-db`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runPrivateDb(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const action = /** @type {'open' | 'close'} */ (ctx.args.action);
  const peer = ctx.args.values.peer;
  /** @param {string} m */
  const refuse = (m) => {
    err(`private-db: ${m}`);
    return 2;
  };
  if (env !== 'rehearsal' || !ENVS[env]?.nodeDir) return refuse('лише --env rehearsal');
  if (action === 'open' && peer === undefined) return refuse('open: потрібен --peer <приватна IPv4 другого вузла>');
  if (action === 'close' && peer !== undefined) return refuse('close: --peer не потрібен');
  // Публічна адреса — відмова ще до входу на вузол (мережа VPC звіряється далі, з самого вузла).
  if (peer !== undefined && !isPrivateV4(peer)) return refuse(`--peer ${peer}: не приватна адреса (RFC 1918) — публічну не відкриваю`);

  /** @type {{ compose: string, proxy: string } | undefined} */
  let files;
  if (action === 'open') {
    try {
      files = {
        compose: fs.readFileSync(path.join(ctx.paths.examplesDir, PRIVATE_DB_COMPOSE), 'utf8'),
        proxy: fs.readFileSync(path.join(ctx.paths.examplesDir, PRIVATE_DB_PROXY), 'utf8'),
      };
    } catch {
      return refuse(`немає ${PRIVATE_DB_COMPOSE} чи ${PRIVATE_DB_PROXY} у ${ctx.paths.examplesDir}`);
    }
  }

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  if (site.transport.kind !== 'ssh' || !site.nodeDir || !site.project) return refuse('лише вузол (--target — адреса основного вузла)');
  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  const journal = drillJournal(ctx, env, { sub: 'private-db', action });
  try {
    return action === 'open'
      ? await openLocked(ctx, { t: site.transport, env, nodeDir: site.nodeDir, project: site.project, peer: /** @type {string} */ (peer), files: /** @type {{ compose: string, proxy: string }} */ (files), journal })
      : await closeLocked(ctx, { t: site.transport, env, nodeDir: site.nodeDir, journal });
  } catch (e) {
    err(`private-db: ${messageOf(e)}`);
    return 1;
  } finally {
    await lock.release();
  }
}

/**
 * @param {OpsContext} ctx
 * @param {{ t: Transport, env: string, nodeDir: string, project: string, peer: string, files: { compose: string, proxy: string }, journal: ReturnType<typeof drillJournal> }} o
 */
async function openLocked(ctx, o) {
  const { out, err } = ctx;
  const { t, env, nodeDir, peer, journal } = o;
  /** @param {string} m */
  const refuse = (m) => {
    err(`private-db: ${m}`);
    return 2;
  };
  // 1. Без змін: VPC з вузла, адреса другого вузла в ній, поточний образ, мережа backend, нічого не відкрито.
  const v = await readVpc(t);
  if (!v.ok) return refuse(v.message);
  const vpc = v.vpc;
  const p = checkPeer(peer, vpc);
  if (!p.ok) return refuse(p.message);
  const sha = await createNode({ transport: t, env, project: o.project, nodeDir, clock: ctx.deps.clock }).readCurrent();
  if (!sha) return refuse('на основному вузлі немає current.env — спершу розгортання');
  const backend = `${o.project}_backend`;
  const net = await remote(t, ['docker', 'network', 'inspect', '--format', '{{.Name}}', backend]);
  if (net.code !== 0) return refuse(`мережі ${backend} немає — стек основного вузла не запущено`);
  const existing = await proxyContainers(t, env);
  if (existing.length) {
    const was = await openPeer(t, nodeDir);
    if (was !== peer) return refuse(`уже відкрито для ${was ?? 'невідомої адреси'} — спершу private-db close`);
    const ok = await verifyListeners(t, { env, nodeDir, privateAddr: vpc.address });
    if (!ok.ok) return refuse(`уже відкрито для ${peer}, але перевірка не пройшла: ${ok.message} — private-db close і повторіть`);
    out(`private-db: уже відкрито для ${peer} на ${vpc.address}:5432 і :6379 — без змін`);
    return 0;
  }
  const before = await remote(t, ['ss', '-Htln']);
  const busy = before.code === 0 ? listenersOn(before.stdout, [...PRIVATE_DB_PORTS]) : [];
  if (before.code !== 0) return refuse(`ss завершився з кодом ${before.code}`);
  if (busy.length) return refuse(`порти вже слухаються: ${busy.map((l) => `${l.address}:${l.port}`).join(', ')} — не чіпаю`);

  out(`private-db: ${env} open — ${vpc.address}:5432 і :6379 (${vpc.iface}) лише для ${peer}`);
  out('private-db: postgres і redis не перезапускаються (окремий проєкт проксі) — простою немає');

  // 2. Зміни, кожна — у журнал; невдача — `close` (повернення як було).
  const envText = `T2F_ENV=${env}\nT2F_SERVER_SHA=${sha}\nT2F_PRIVATE_ADDR=${vpc.address}\nT2F_PRIVATE_DB_PEER=${peer}\nT2F_BACKEND_NETWORK=${backend}\n`;
  /** @type {[string, () => Promise<void>][]} */
  const steps = [
    [
      'files',
      async () => {
        await writeRemote(t, path.posix.join(nodeDir, PRIVATE_DB_PROXY), o.files.proxy, '022');
        await writeRemote(t, path.posix.join(nodeDir, PRIVATE_DB_COMPOSE), o.files.compose, '077');
        await writeRemote(t, path.posix.join(nodeDir, PRIVATE_DB_ENV), envText, '077');
      },
    ],
    [
      'up',
      async () => {
        const r = await remote(t, [...composeOf(env, nodeDir), 'up', '-d', '--wait', PRIVATE_DB_SERVICE], { timeoutMs: UP_TIMEOUT_MS });
        if (r.code !== 0) throw new Error(`проксі не запустився (код ${r.code})`);
      },
    ],
    [
      'verify',
      async () => {
        const ok = await verifyListeners(t, { env, nodeDir, privateAddr: vpc.address });
        if (!ok.ok) throw new Error(ok.message);
      },
    ],
  ];
  for (const [i, [name, fn]] of steps.entries()) {
    try {
      await fn();
    } catch (e) {
      journal.append({ step: name, result: 'failed', peer, privateAddr: vpc.address });
      err(`private-db: крок ${i + 1} ${name} не вдався: ${messageOf(e)}`);
      try {
        const c = await closeSteps(t, env, nodeDir);
        journal.append({ step: 'rollback', result: 'ok', ...c });
        err('private-db: повернуто як було (проксі, мережа й файли прибрано)');
      } catch (e2) {
        journal.append({ step: 'rollback', result: 'failed' });
        err(`private-db: повернення не вдалося: ${messageOf(e2)} — запустіть private-db close`);
      }
      return 1;
    }
    journal.append({ step: name, result: 'ok', peer, privateAddr: vpc.address, ...(name === 'up' ? { outage: 'none: postgres/redis not recreated' } : {}) });
    out(`private-db: ${i + 1}. ${name} — готово`);
  }
  out(`private-db: перевірено з вузла — 5432 і 6379 слухаються лише на ${vpc.address}; журнал — ${journal.file}`);
  out(`private-db: ззовні перевірте: nc -vz -w 3 <публічна адреса основного> 5432 (і 6379) — НЕ з’єднується; з другого вузла: nc -vz -w 3 ${vpc.address} 5432 — з’єднується`);
  return 0;
}

/**
 * Ідемпотентне: прибирає те, що є, і перевіряє, що порти не слухаються.
 * @param {OpsContext} ctx
 * @param {{ t: Transport, env: string, nodeDir: string, journal: ReturnType<typeof drillJournal> }} o
 */
async function closeLocked(ctx, o) {
  const { out, err } = ctx;
  const { t, env, nodeDir, journal } = o;
  /** @type {{ containers: number, networks: number }} */
  let c;
  try {
    c = await closeSteps(t, env, nodeDir);
  } catch (e) {
    journal.append({ step: 'down', result: 'failed' });
    err(`private-db: close не вдався: ${messageOf(e)}`);
    return 1;
  }
  journal.append({ step: 'down', result: 'ok', ...c });
  out(`private-db: ${env} close — контейнерів ${c.containers}, мереж ${c.networks} прибрано; файли проксі видалено`);
  const ok = await verifyListeners(t, { env, nodeDir, privateAddr: null });
  const left = await proxyContainers(t, env);
  if (!ok.ok || left.length) {
    journal.append({ step: 'verify', result: 'failed' });
    err(`private-db: після close: ${ok.ok ? `лишилися контейнери проксі (${left.length})` : ok.message}`);
    return 1;
  }
  journal.append({ step: 'verify', result: 'ok' });
  out(`private-db: перевірено з вузла — 5432 і 6379 не слухаються; журнал — ${journal.file}`);
  out('private-db: ззовні перевірте: nc -vz -w 3 <публічна адреса основного> 5432 (і 6379) — НЕ з’єднується');
  return 0;
}
