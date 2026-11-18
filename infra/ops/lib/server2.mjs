// @ts-check
// `ops server2 --env rehearsal --target <основний вузол> up|down` (O·P18a, навчання «два сервери»).
// `up`: той самий образ сервера, що зараз працює на основному вузлі (`current.env` там), доставляється на другий вузол
// так само, як у `deploy` (`docker save | gzip` → `docker load`), разом із `compose.server2.yml` і похідним
// `server.env` (у ньому міняються лише хости DATABASE_URI, REDIS_URL, T2F_CENTRIFUGO_URL — на приватну адресу
// основного); сервер стартує й чекає здоров’я. Міграцій немає; контейнер сервера основного вузла не чіпається
// (з основного лише читання). `down`: контейнер і мережі проєкту другого вузла прибираються, `server.env` там і
// похідний `.local/<env>/server2.env` видаляються. Другий вузол — лише з провайдера за трьома тегами.
// Коди: 0 — готово; 2 — відмова до будь-якої зміни; 1 — крок не вдався.
import fs from 'node:fs';
import path from 'node:path';
import { classify, envTag, ROLE_MAIN, ROLE_SERVER2, server2Dir, TAG_MANAGED } from './capacity/plan.mjs';
import { DEPLOY_USER, knownHostsFile, messageOf, reportFailure, resolveSite } from './common.mjs';
import { ENVS } from './config.mjs';
import { deployedShas } from './journal.mjs';
import { createNode, CURRENT_ENV, NEXT_ENV } from './node.mjs';
import { drillJournal, inNet, isPrivateV4, openPeer, proxyContainers, readVpc } from './privateDb.mjs';
import { getVar, setVar } from './secrets/envFile.mjs';
import { assertPrivatePath, pushFile, writePrivate } from './secrets/files.mjs';
import { checkTarget } from './target.mjs';

export const SERVER2_COMPOSE = 'compose.server2.yml';
/** Похідний файл змінних на машині оператора (`.local/<env>/server2.env`, не в git). */
export const SERVER2_ENV = 'server2.env';
/** Змінна → хост сервісу основного вузла, який замінюється приватною адресою. Решта рядків — без змін. */
export const SERVER2_HOSTS = /** @type {const} */ ({ DATABASE_URI: 'postgres', REDIS_URL: 'redis', T2F_CENTRIFUGO_URL: 'centrifugo' });
const HEALTH_TIMEOUT_MS = 180_000;
const TIMEOUT_MS = 60_000;
const RE_ID = /^[0-9a-f]{12,64}$/;

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('./capacity/provider.mjs').Node} Node
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 */

/** @param {string} env */
export const server2Project = (env) => `t2f-${env}-server2`;

/**
 * Замінює лише хост у `scheme://[userinfo@]host[:port][/...]`, якщо він дорівнює `expect`; інакше `null`.
 * @param {string} value
 * @param {string} expect
 * @param {string} addr
 */
export function replaceHost(value, expect, addr) {
  const m = String(value).match(/^([a-z][a-z0-9+.-]*:\/\/)([^@/?#]*@)?([^:/?#@[\]]+)(:\d{1,5})?([/?#].*)?$/i);
  if (!m || m[3].toLowerCase() !== expect) return null;
  return `${m[1]}${m[2] ?? ''}${addr}${m[4] ?? ''}${m[5] ?? ''}`;
}

/**
 * Похідний `server.env` другого вузла. Повідомлення називають лише змінні — значень ніколи.
 * @param {string} text `server.env` основного вузла
 * @param {string} addr приватна адреса основного вузла
 * @returns {{ ok: true, text: string, replaced: string[] } | { ok: false, message: string }}
 */
export function deriveServer2Env(text, addr) {
  if (!isPrivateV4(addr)) return { ok: false, message: 'адреса основного вузла не приватна (RFC 1918)' };
  let out = String(text);
  /** @type {string[]} */
  const replaced = [];
  for (const [name, host] of Object.entries(SERVER2_HOSTS)) {
    const v = getVar(out, name);
    if (v === undefined || v === '') return { ok: false, message: `${name}: немає в server.env` };
    const next = replaceHost(v, host, addr);
    if (next === null) return { ok: false, message: `${name}: хост не ${host} — не змінюю (значення не друкую)` };
    out = setVar(out, name, next);
    replaced.push(name);
  }
  return { ok: true, text: out, replaced };
}

/**
 * Єдиний вузол другого сервера з провайдера: усі три теги, не основний.
 * @param {OpsContext} ctx
 * @param {string} env
 * @returns {Promise<{ ok: true, node: Node } | { ok: false, message: string }>}
 */
async function findServer2(ctx, env) {
  const { provider } = await ctx.deps.provider();
  const seen = classify([await provider.listNodes([TAG_MANAGED]), await provider.listNodes([envTag(env)])], env);
  const mainIds = new Set(seen.main.map((n) => n.id));
  const nodes = seen.server2.filter((n) => !n.tags.includes(ROLE_MAIN) && !mainIds.has(n.id));
  if (nodes.length !== 1) return { ok: false, message: `вузлів другого сервера (${TAG_MANAGED}, ${envTag(env)}, ${ROLE_SERVER2}) ${nodes.length}: очікується один — спершу capacity server2-create` };
  return { ok: true, node: /** @type {Node} */ (nodes[0]) };
}

/**
 * @param {Transport} t
 * @param {string[]} argv
 */
const remote = (t, argv) => t.exec(argv, { allow: [...argv], timeoutMs: TIMEOUT_MS });

/**
 * `ops server2`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runServer2(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const action = /** @type {'up' | 'down'} */ (ctx.args.action);
  /** @param {string} m */
  const refuse = (m) => {
    err(`server2: ${m}`);
    return 2;
  };
  if (env !== 'rehearsal' || !ENVS[env]?.nodeDir) return refuse('лише --env rehearsal');

  /** @type {Node} */
  let node;
  try {
    const found = await findServer2(ctx, env);
    if (!found.ok) return refuse(found.message);
    node = found.node;
  } catch (e) {
    return refuse(messageOf(e));
  }
  if (!node.publicIp) return refuse(`у вузла ${node.name} немає публічної адреси`);
  // Адреса від провайдера — та сама звірка зі старою продакшн-адресою, що й `--target` (AC-22), до першого SSH.
  const checked = await checkTarget(node.publicIp, ctx.deps);
  if (!checked.ok) return refuse(`вузол ${node.name}: ${checked.message}`);
  if (!checked.address) return refuse(`вузол ${node.name}: публічна адреса не IPv4`);
  /** @type {Transport} */
  let t2;
  try {
    t2 = ctx.deps.transport({ host: checked.address, user: DEPLOY_USER, knownHostsFile: knownHostsFile(ctx) });
  } catch (e) {
    return refuse(messageOf(e));
  }
  const dir = server2Dir(env);
  const node2 = createNode({ transport: t2, env, project: server2Project(env), nodeDir: dir, clock: ctx.deps.clock });
  const journal = drillJournal(ctx, env, { sub: 'server2', action, node: node.name });

  if (action === 'down') return down(ctx, { t2, env, dir, journal, nodeName: node.name });

  // up, 1. Без змін: основний вузол (поточний образ, VPC, відкритий доступ саме для цього вузла), похідні змінні.
  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  if (site.transport.kind !== 'ssh' || !site.nodeDir || !site.project) return refuse('лише вузол (--target — адреса основного вузла)');
  /** @type {string | null} */
  let sha;
  /** @type {string} */
  let mainPrivate;
  try {
    sha = await createNode({ transport: site.transport, env, project: site.project, nodeDir: site.nodeDir, clock: ctx.deps.clock }).readCurrent();
    if (!sha) return refuse('на основному вузлі немає current.env — спершу розгортання');
    const last = deployedShas(await site.journal.read(), env)[0];
    if (last && last !== sha) out(`server2: увага — останнє успішне розгортання в журналі ${last.slice(0, 12)}, а працює ${sha.slice(0, 12)} (відкат?); беру те, що працює`);
    const v = await readVpc(site.transport);
    if (!v.ok) return refuse(v.message);
    mainPrivate = v.vpc.address;
    if (!node.privateIp || !inNet(node.privateIp, v.vpc.address, v.vpc.prefix)) {
      return refuse(`приватна адреса ${node.name} (${node.privateIp ?? 'немає'}) поза VPC основного ${v.vpc.address}/${v.vpc.prefix}`);
    }
    const peer = await openPeer(site.transport, site.nodeDir);
    const proxy = await proxyContainers(site.transport, env);
    if (peer !== node.privateIp || !proxy.length) return refuse(`доступ до бази не відкрито для ${node.privateIp} — спершу private-db --env ${env} --target <основний> open --peer ${node.privateIp}`);
  } catch (e) {
    return refuse(messageOf(e));
  }

  const localDir = path.join(ctx.paths.stateRoot, env);
  /** @type {string} */
  let serverEnv;
  /** @type {string} */
  let composeText;
  try {
    serverEnv = fs.readFileSync(path.join(localDir, 'server.env'), 'utf8');
  } catch {
    return refuse(`немає .local/${env}/server.env (оригінал змінних основного вузла)`);
  }
  try {
    composeText = fs.readFileSync(path.join(ctx.paths.examplesDir, SERVER2_COMPOSE), 'utf8');
  } catch {
    return refuse(`немає ${SERVER2_COMPOSE} у ${ctx.paths.examplesDir}`);
  }
  const derived = deriveServer2Env(serverEnv, mainPrivate);
  if (!derived.ok) return refuse(derived.message);
  const envFile = path.join(localDir, SERVER2_ENV);
  try {
    await assertPrivatePath(ctx, envFile);
    writePrivate(envFile, derived.text);
  } catch (e) {
    return refuse(messageOf(e));
  }
  out(`server2: ${SERVER2_ENV} — хости ${derived.replaced.join(', ')} → ${mainPrivate} (значення не друкуються)`);
  const free = await node2.freeBytes(composeText).catch((e) => ({ code: /** @type {const} */ (2), message: messageOf(e) }));
  if (free.code !== 0) return refuse(free.message);

  // 2. Зміни лише на другому вузлі: образ, файли, запуск, здоров’я.
  out(`server2: ${node.name} ← t2f-server:${sha.slice(0, 12)} (той самий образ, що на основному; міграцій немає)`);
  const image = ctx.deps.image();
  const s = /** @type {string} */ (sha);
  /** @type {[string, () => Promise<{ code: number, message?: string, detail?: string }>][]} */
  const steps = [
    ['build', () => image.buildImage(s)],
    ['deliver', () => image.deliver(t2, s)],
    [
      'files',
      async () => {
        await node2.uploadCompose(composeText);
        await pushFile(t2, dir, 'server.env', derived.text);
        await node2.prepare(s);
        return { code: 0 };
      },
    ],
    ['start', () => node2.swap(NEXT_ENV)],
    ['health', () => node2.waitHealthy(NEXT_ENV, s, HEALTH_TIMEOUT_MS)],
  ];
  for (const [i, [name, fn]] of steps.entries()) {
    /** @type {{ code: number, message?: string, detail?: string }} */
    let r;
    try {
      r = await fn();
    } catch (e) {
      r = { code: 1, message: messageOf(e) };
    }
    journal.append({ step: name, result: r.code === 0 ? 'ok' : 'failed', commit: s });
    if (r.code !== 0) {
      err(`server2: крок ${i + 1} ${name} не вдався: ${r.message ?? ''}`);
      reportFailure(err, r);
      err(`server2: основний вузол не змінювався; прибрати другий — server2 --env ${env} --target <основний> down`);
      return 1;
    }
    out(`server2: ${i + 1}. ${name} — готово`);
  }
  await node2.setCurrent(s);
  out(`server2: ${node.name} здоровий (200 ${s.slice(0, 12)}); публічного входу немає; журнал — ${journal.file}`);
  return 0;
}

/**
 * Прибирає контейнери й мережі проєкту другого вузла, `server.env` і файли інтерполяції там, похідний файл тут.
 * Ідемпотентне.
 * @param {OpsContext} ctx
 * @param {{ t2: Transport, env: string, dir: string, journal: ReturnType<typeof drillJournal>, nodeName: string }} o
 */
async function down(ctx, o) {
  const { out, err } = ctx;
  const { t2, env, dir, journal } = o;
  const label = `label=com.docker.compose.project=${server2Project(env)}`;
  try {
    const ps = await remote(t2, ['docker', 'ps', '-aq', '--filter', label]);
    if (ps.code !== 0) throw new Error(`docker ps завершився з кодом ${ps.code}`);
    const ids = ps.stdout.split(/\s+/).filter((x) => RE_ID.test(x));
    if (ids.length) {
      const r = await t2.exec(['docker', 'rm', '-f', ...ids], { allow: ['docker', 'rm', '-f', ...ids], timeoutMs: 5 * TIMEOUT_MS });
      if (r.code !== 0) throw new Error(`docker rm завершився з кодом ${r.code}`);
    }
    const nets = await remote(t2, ['docker', 'network', 'ls', '-q', '--filter', label]);
    if (nets.code !== 0) throw new Error(`docker network ls завершився з кодом ${nets.code}`);
    const netIds = nets.stdout.split(/\s+/).filter((x) => RE_ID.test(x));
    if (netIds.length) {
      const r = await remote(t2, ['docker', 'network', 'rm', ...netIds]);
      if (r.code !== 0) throw new Error(`docker network rm завершився з кодом ${r.code}`);
    }
    const rm = await remote(t2, ['sh', '-c', 'cd -- "$1" 2>/dev/null || exit 0; rm -f -- "$2" "$3" "$4"', '_', dir, 'server.env', CURRENT_ENV, NEXT_ENV]);
    if (rm.code !== 0) throw new Error(`файли на вузлі не прибрано (код ${rm.code})`);
    fs.rmSync(path.join(ctx.paths.stateRoot, env, SERVER2_ENV), { force: true });
    journal.append({ step: 'down', result: 'ok', containers: ids.length, networks: netIds.length });
    out(`server2: ${o.nodeName} down — контейнерів ${ids.length}, мереж ${netIds.length}; server.env там і ${SERVER2_ENV} тут видалено`);
    out(`server2: далі — private-db --env ${env} --target <основний> close, потім capacity --env ${env} server2-delete`);
    return 0;
  } catch (e) {
    journal.append({ step: 'down', result: 'failed' });
    err(`server2: down не вдався: ${messageOf(e)}`);
    return 1;
  }
}
