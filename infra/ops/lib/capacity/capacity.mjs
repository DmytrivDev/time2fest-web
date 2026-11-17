// @ts-check
// `ops capacity --env <rehearsal|production> <plan|night|back|off-season|realtime-create|realtime-delete|status>
//   [--size <s>] [--confirm <env>] [--probe]` (AC-45 … AC-53, NFR-3, NFR-5).
// Бажаний стан рахується від СПОСТЕРЕЖЕНОГО стану провайдера, тож повторний запуск пропускає вже виконані кроки
// (AC-52). Вузли обираються лише за тегами `t2f-managed` + `t2f-env-<env>` і роллю; ресурс без обох тегів не
// змінюється (AC-47). Основний вузол — лише вертикальна зміна розміру (AC-48, AC-50); вузол realtime — створення з
// тегами й підготовкою (AC-8) і видалення, ніколи не вимкнення (AC-49). Кроку, що запускає `server`, немає (AC-50).
// Без `--confirm <env>` — лише план з ціною за годину кожного кроку, що створює чи збільшує ресурс (AC-46, NFR-5).
// Коди: 0 — готово або лише план; 2 — відмова до будь-якої зміни; 1 — помилка провайдера чи кроку (виконане надруковано).
import fs from 'node:fs';
import path from 'node:path';
import { SUBCOMMAND_SPECS } from '../args.mjs';
import { ROOT_STEPS, runBootstrap } from '../bootstrap.mjs';
import { ENVS } from '../config.mjs';
import { DEFAULT_STATE_ROOT, DEPLOY_USER, messageOf } from '../deploy.mjs';
import { REPO_ROOT } from '../exec.mjs';
import { SYSTEM_CLOCK } from '../node.mjs';
import { startProbe as realStartProbe } from '../probe.mjs';
import { loadProvider } from './providers.mjs';

export const TAG_MANAGED = 't2f-managed';
export const ROLE_MAIN = 't2f-role-main';
export const ROLE_REALTIME = 't2f-role-realtime';
/** @param {string} env */
export const envTag = (env) => `t2f-env-${env}`;
/** Профіль Compose вузла realtime (P4): лише `cloudflared`. */
export const REALTIME_COMPOSE_PATH = 'infra/ops/node/compose.realtime.yml';
export const REALTIME_COMPOSE_FILE = 'compose.realtime.yml';
/** @param {string} env */
export const realtimeDir = (env) => `/srv/t2f/${env}-realtime`;
/** @param {string} env */
export const realtimeName = (env) => `t2f-${env}-realtime`;
export const JOURNAL_NAME = 'capacity.jsonl';

const SSH_WAIT = { tries: 60, everyMs: 5_000 };
const REMOTE_TIMEOUT_MS = 60_000;
const HEALTH_WAIT_MS = 300_000;
const HEALTH_EVERY_MS = 1_000;

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('./provider.mjs').Size} Size
 * @typedef {import('./provider.mjs').ProviderBundle} ProviderBundle
 * @typedef {import('./provider.mjs').EnvSizes} EnvSizes
 * @typedef {import('../node.mjs').Clock} Clock
 * @typedef {import('../exec.mjs').Transport} Transport
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 * @typedef {{
 *   capacity?: ProviderBundle,
 *   realtimeComposeFile?: string,
 *   fetch?: typeof globalThis.fetch,
 * }} CapacityDeps `capacity` — підставний провайдер (фейк у тестах); без нього — з `T2F_PROVIDER`.
 * @typedef {(
 *   | { kind: 'resize', node: Node, from: string, to: string, price: number, verb: 'збільшити' | 'зменшити' | 'увімкнути' }
 *   | { kind: 'create', name: string, size: string, region: string, tags: string[], price: number }
 *   | { kind: 'prepare', name: string, nodeId: string | null }
 *   | { kind: 'delete', node: Node }
 * )} Step
 * @typedef {{ main: Node[], realtime: Node[], other: Node[], suspects: Node[] }} Observed
 */

/** @param {number} p */
const price = (p) => `$${p}/год`;

/**
 * Розкладає вузли на свої (обидва теги), підозрілі (лише один із тегів) і чужі середовища.
 * @param {Node[][]} lists
 * @param {string} env
 * @returns {Observed}
 */
export function classify(lists, env) {
  /** @type {Map<string, Node>} */
  const all = new Map();
  for (const n of lists.flat()) all.set(n.id, n);
  /** @type {Observed} */
  const o = { main: [], realtime: [], other: [], suspects: [] };
  for (const n of all.values()) {
    const managed = n.tags.includes(TAG_MANAGED);
    const ours = n.tags.includes(envTag(env));
    const otherEnv = n.tags.some((t) => t.startsWith('t2f-env-') && t !== envTag(env));
    if (managed && ours) {
      if (n.tags.includes(ROLE_MAIN)) o.main.push(n);
      else if (n.tags.includes(ROLE_REALTIME)) o.realtime.push(n);
      else o.other.push(n);
    } else if (ours || (managed && !otherEnv)) {
      o.suspects.push(n);
    }
  }
  return o;
}

/**
 * Профіль Compose: імена сервісів верхнього рівня `services:` (відступ 2 пробіли).
 * @param {string} text
 */
export function composeServices(text) {
  /** @type {string[]} */
  const names = [];
  let inServices = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^services:\s*(#.*)?$/.test(line)) {
      inServices = true;
      continue;
    }
    if (!inServices || line.trim() === '' || /^\s*#/.test(line)) continue;
    if (/^\S/.test(line)) {
      inServices = false;
      continue;
    }
    const m = line.match(/^ {2}([A-Za-z0-9_.-]+):\s*(#.*)?$/);
    if (m) names.push(m[1]);
  }
  return names;
}

/**
 * Записи журналу потужності (пошкоджені рядки пропускаються).
 * @param {string} file
 * @returns {any[]}
 */
function readJournal(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim() !== '')
    .flatMap((l) => {
      try {
        return [JSON.parse(l)];
      } catch {
        return [];
      }
    });
}

/**
 * `ops capacity`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runCapacity(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const action = /** @type {string} */ (ctx.args.action);
  const deps = /** @type {CapacityDeps & import('../../ops.mjs').OpsDeps} */ (ctx.deps ?? {});
  const clock = deps.clock ?? SYSTEM_CLOCK;
  const confirm = ctx.args.values.confirm;
  const sizeArg = ctx.args.values.size;
  /** @param {string} m */
  const refuse = (m) => {
    err(`capacity: ${m}`);
    return 2;
  };

  if (confirm !== undefined && confirm !== env) return refuse(`--confirm ${confirm} не збігається з --env ${env}`);
  if (action === 'night' && sizeArg === undefined) return refuse('night: потрібен --size <розмір>');
  if (action !== 'night' && sizeArg !== undefined) return refuse(`--size дозволено лише для night`);

  /** @type {ProviderBundle} */
  let bundle;
  try {
    bundle = deps.capacity ?? (await loadProvider(ctx.env));
  } catch (e) {
    return refuse(messageOf(e));
  }
  const envSizes = Object.hasOwn(bundle.envSizes, env) ? bundle.envSizes[env] : undefined;
  if (!envSizes) return refuse(`у провайдера немає розмірів для середовища ${env}`);
  const { provider } = bundle;

  // Спостереження (лише читання): усі керовані вузли, усі вузли середовища, розміри з цінами.
  /** @type {Observed} */
  let seen;
  /** @type {Size[]} */
  let sizes;
  try {
    seen = classify([await provider.listNodes([TAG_MANAGED]), await provider.listNodes([envTag(env)])], env);
    sizes = await provider.sizes();
  } catch (e) {
    err(`capacity: ${messageOf(e)}`);
    err('capacity: виконано: нічого');
    return 1;
  }
  /** @param {string} slug */
  const sizeOf = (slug) => sizes.find((s) => s.slug === slug);
  const suspectLine = (/** @type {Node} */ n) => `${n.name}: немає обох тегів ${TAG_MANAGED} і ${envTag(env)} — не змінюється`;

  if (action === 'plan') return printInventory(ctx, bundle.name, env, envSizes, seen, sizes, suspectLine);
  if (action === 'status') return printStatus(ctx, env, envSizes, seen, sizeOf, suspectLine);

  // AC-47: ресурс з роллю, яку зачіпає дія, але без обох тегів — відмова з його назвою, до будь-якої зміни.
  const touchesMain = ['night', 'back', 'off-season'].includes(action);
  const touchesRealtime = ['off-season', 'realtime-create', 'realtime-delete'].includes(action);
  const blocked = seen.suspects.filter(
    (n) =>
      (touchesMain && n.tags.includes(ROLE_MAIN)) ||
      (touchesRealtime && (n.tags.includes(ROLE_REALTIME) || n.name === realtimeName(env))),
  );
  if (blocked.length) {
    return refuse(`відмова: ${blocked.map((n) => n.name).join(', ')} — немає обох тегів ${TAG_MANAGED} і ${envTag(env)}; змінювати чи видаляти не буду`);
  }

  /** @type {Step[]} */
  const steps = [];
  if (touchesMain) {
    const target = action === 'night' ? /** @type {string} */ (sizeArg) : envSizes.main.offSeason;
    if (!envSizes.main.allowed.includes(target)) {
      return refuse(`розмір ${target} не в переліку дозволених для ${env}: ${envSizes.main.allowed.join(', ')}`);
    }
    const to = sizeOf(target);
    if (!to) return refuse(`розмір ${target} недоступний у провайдера`);
    if (seen.main.length !== 1) {
      // AC-50: другого екземпляра сервера немає й не створюється; основний вузол не створюється командою.
      return refuse(seen.main.length ? `основних вузлів ${seen.main.length} (${seen.main.map((n) => n.name).join(', ')}): очікується один` : `основного вузла ${env} немає (теги ${TAG_MANAGED}, ${envTag(env)}, ${ROLE_MAIN})`);
    }
    const main = /** @type {Node} */ (seen.main[0]);
    if (main.size !== target || main.status !== 'active') {
      const from = sizeOf(main.size);
      const bigger = !from || to.vcpus > from.vcpus || to.memoryMb > from.memoryMb;
      const verb = main.size === target ? 'увімкнути' : bigger ? 'збільшити' : 'зменшити';
      steps.push({ kind: 'resize', node: main, from: main.size, to: target, price: to.priceHourly, verb });
    }
  }
  if (action === 'realtime-create') {
    const bootEnvs = SUBCOMMAND_SPECS.bootstrap.envs ?? [];
    if (!bootEnvs.includes(env)) return refuse(`realtime-create: підготовка вузла (bootstrap) зараз лише для ${bootEnvs.join(', ')}`);
    if (seen.realtime.length > 1) return refuse(`вузлів realtime ${seen.realtime.length}: очікується не більше одного`);
    const existing = seen.realtime[0];
    if (!existing) {
      const size = sizeOf(envSizes.realtime.size);
      if (!size) return refuse(`розмір ${envSizes.realtime.size} недоступний у провайдера`);
      const tags = [TAG_MANAGED, envTag(env), ROLE_REALTIME];
      steps.push({ kind: 'create', name: realtimeName(env), size: size.slug, region: envSizes.region, tags, price: size.priceHourly });
      steps.push({ kind: 'prepare', name: realtimeName(env), nodeId: null });
    } else {
      const prepared = readJournal(journalFile(deps, env)).some((r) => r?.step === 'prepare' && r?.result === 'ok' && r?.nodeId === existing.id);
      if (!prepared) steps.push({ kind: 'prepare', name: existing.name, nodeId: existing.id });
    }
  }
  if (action === 'realtime-delete' || action === 'off-season') {
    for (const n of seen.realtime) steps.push({ kind: 'delete', node: n });
  }

  /** @type {string | undefined} */
  let composeText;
  if (steps.some((s) => s.kind === 'prepare')) {
    const file = deps.realtimeComposeFile ?? path.join(REPO_ROOT, REALTIME_COMPOSE_PATH);
    try {
      composeText = fs.readFileSync(file, 'utf8');
    } catch {
      return refuse(`немає профілю вузла realtime ${REALTIME_COMPOSE_PATH}`);
    }
    const services = composeServices(composeText);
    // AC-49, AC-50: профіль realtime — лише `cloudflared`, без `server`.
    if (services.length !== 1 || services[0] !== 'cloudflared') {
      return refuse(`профіль realtime має містити лише cloudflared, а містить: ${services.join(', ') || 'нічого'}`);
    }
  }

  out(`capacity ${env} ${action}: план`);
  if (!steps.length) {
    out('  нічого робити — стан уже такий');
    return 0;
  }
  steps.forEach((s, i) => out(`  ${i + 1}. ${label(s, env)}`));
  if (confirm !== env) {
    out(`capacity: це лише план; щоб виконати — --confirm ${env}`);
    return 0;
  }
  return execute(ctx, { env, action, steps, bundle, clock, composeText: composeText ?? '' });
}

/**
 * @param {CapacityDeps & { stateRoot?: string }} deps
 * @param {string} env
 */
function journalFile(deps, env) {
  return path.join(deps.stateRoot ?? DEFAULT_STATE_ROOT, env, JOURNAL_NAME);
}

/**
 * Рядок кроку для плану й звіту. Ціна — для кожного кроку, що створює ресурс чи міняє його розмір (NFR-5).
 * @param {Step} s
 * @param {string} env
 */
export function label(s, env) {
  switch (s.kind) {
    case 'resize':
      return `${s.verb} ${s.node.name}: ${s.from} → ${s.to} (лише CPU і RAM, диск без змін) — ${price(s.price)}`;
    case 'create':
      return `створити ${s.name} (${s.size}, ${s.region}, теги ${s.tags.join(' ')}) — ${price(s.price)}`;
    case 'prepare':
      return `підготувати ${s.name}: bootstrap і ${REALTIME_COMPOSE_FILE} у ${realtimeDir(env)} (не запускається)`;
    case 'delete':
      return `видалити ${s.node.name} (${s.node.size}) — видалення, не вимкнення`;
  }
}

/**
 * @param {OpsContext} ctx
 * @param {{ env: string, action: string, steps: Step[], bundle: ProviderBundle, clock: Clock, composeText: string }} o
 * @returns {Promise<number>}
 */
async function execute(ctx, o) {
  const { out, err } = ctx;
  const deps = /** @type {CapacityDeps & import('../../ops.mjs').OpsDeps} */ (ctx.deps ?? {});
  const file = journalFile(deps, o.env);
  /** @param {Record<string, unknown>} rec */
  const journal = (rec) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, `${JSON.stringify({ at: ctx.now().toISOString(), env: o.env, action: o.action, ...rec })}\n`);
  };
  /** @type {Node | undefined} вузол realtime, створений у цьому запуску */
  let created;
  /** @type {string[]} */
  const done = [];

  for (const [i, s] of o.steps.entries()) {
    const t0 = o.clock.now();
    const seconds = () => Math.max(0, Math.round((o.clock.now() - t0) / 1000));
    /** @type {{ downtimeSeconds: number } | undefined} */
    let probed;
    try {
      if (s.kind === 'resize') {
        const probe = startProbeFor(ctx, o.env);
        try {
          await o.bundle.provider.resizeNode(s.node.id, s.to);
          if (probe) await waitSiteHealthy(ctx, o.env, o.clock);
        } finally {
          probed = probe?.stop();
        }
      } else if (s.kind === 'create') {
        created = await o.bundle.provider.createNode({ name: s.name, region: s.region, size: s.size, tags: s.tags });
      } else if (s.kind === 'prepare') {
        const nodeId = s.nodeId ?? created?.id;
        const node = nodeId ? (await o.bundle.provider.listNodes([TAG_MANAGED, envTag(o.env), ROLE_REALTIME])).find((n) => n.id === nodeId) : undefined;
        if (!node) throw new Error(`вузол realtime ${s.name} не знайдено`);
        await prepareRealtime(ctx, node, o.composeText, o.clock);
        s.nodeId = node.id;
      } else {
        await o.bundle.provider.deleteNode(s.node.id);
      }
    } catch (e) {
      const rec = stepRecord(s, created);
      journal({ ...rec, result: 'failed', seconds: seconds(), ...(probed ? { downtimeSeconds: probed.downtimeSeconds } : {}) });
      err(`capacity: крок ${i + 1} не вдався: ${label(s, o.env)}`);
      err(`  ${messageOf(e)}`);
      err(`capacity: виконано: ${done.length ? done.join('; ') : 'нічого'}`);
      err('capacity: повторний запуск продовжить з невиконаних кроків (стан читається з провайдера)');
      return 1;
    }
    const secs = seconds();
    journal({ ...stepRecord(s, created), result: 'ok', seconds: secs, ...(probed ? { downtimeSeconds: probed.downtimeSeconds } : {}) });
    const timing = probed ? `за ${secs} с, простій ${probed.downtimeSeconds} с` : `за ${secs} с`;
    out(`capacity: ${i + 1}. готово ${timing}`);
    done.push(`${i + 1}. ${label(s, o.env)}`);
  }
  out(`capacity ${o.env} ${o.action}: готово; журнал — ${file}`);
  return 0;
}

/**
 * @param {Step} s
 * @param {Node | undefined} created
 */
function stepRecord(s, created) {
  switch (s.kind) {
    case 'resize':
      return { step: 'resize', node: s.node.name, nodeId: s.node.id, from: s.from, to: s.to };
    case 'create':
      return { step: 'create', node: s.name, nodeId: created?.id ?? null, to: s.size };
    case 'prepare':
      return { step: 'prepare', node: s.name, nodeId: s.nodeId ?? created?.id ?? null };
    case 'delete':
      return { step: 'delete', node: s.node.name, nodeId: s.node.id };
  }
}

/**
 * Зонд простою (`--probe`, AC-53) через край: `https://<siteHost>/api/health`.
 * @param {OpsContext} ctx
 * @param {string} env
 */
function startProbeFor(ctx, env) {
  if (ctx.args.flags.probe !== true) return undefined;
  const host = ENVS[env]?.siteHost;
  if (!host) {
    ctx.err(`capacity: зонд простою не запущено: у середовища ${env} немає імені сайту`);
    return undefined;
  }
  const start = ctx.deps?.startProbe ?? realStartProbe;
  return start({ url: `https://${host}/api/health` });
}

/**
 * Після зміни розміру — чекати першої відповіді 200 сайту, щоб зонд захопив увесь простій (до 300 с).
 * @param {OpsContext} ctx
 * @param {string} env
 * @param {Clock} clock
 */
async function waitSiteHealthy(ctx, env, clock) {
  const host = ENVS[env]?.siteHost;
  const doFetch = /** @type {CapacityDeps} */ (ctx.deps ?? {}).fetch ?? globalThis.fetch;
  const deadline = clock.now() + HEALTH_WAIT_MS;
  for (;;) {
    const ok = await doFetch(`https://${host}/api/health`, { signal: AbortSignal.timeout(2_000) }).then(
      (r) => r.status === 200,
      () => false,
    );
    if (ok) return;
    if (clock.now() >= deadline) throw new Error(`сайт ${host} не відповів 200 за ${HEALTH_WAIT_MS / 1000} с після зміни розміру`);
    await clock.sleep(HEALTH_EVERY_MS);
  }
}

/**
 * @param {Transport} t
 * @param {string[]} argv
 * @param {{ input?: string, timeoutMs?: number }} [o]
 */
const remote = (t, argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? REMOTE_TIMEOUT_MS, ...(o.input !== undefined ? { input: o.input } : {}) });

/**
 * Підготовка вузла realtime: чекати SSH; від імені root — користувач `deploy` і каталог `/srv/t2f/<env>-realtime`
 * (кроки `ROOT_STEPS`); далі весь `bootstrap` (AC-8); потім `compose.realtime.yml` у каталог — без запуску.
 * Кожна частина спершу перевіряє «вже зроблено», тож повтор безпечний.
 * @param {OpsContext} ctx
 * @param {Node} node
 * @param {string} composeText
 * @param {Clock} clock
 */
async function prepareRealtime(ctx, node, composeText, clock) {
  const env = /** @type {string} */ (ctx.args.env);
  const dir = realtimeDir(env);
  const ip = node.publicIp;
  if (!ip) throw new Error(`у вузла ${node.name} немає публічної адреси`);
  const deps = ctx.deps ?? {};
  const stateRoot = deps.stateRoot ?? DEFAULT_STATE_ROOT;
  const knownHosts = ctx.env.T2F_KNOWN_HOSTS_FILE || path.join(stateRoot, 'known_hosts');
  const sshAs = deps.sshAs ?? ((/** @type {string} */ user) => ctx.exec.sshTransport({ host: ip, user, knownHostsFile: knownHosts, accept: 'new' }));
  if (!deps.sshAs) fs.mkdirSync(path.dirname(knownHosts), { recursive: true });
  const asRoot = sshAs('root');
  const asDeploy = sshAs(DEPLOY_USER);

  /** @type {'root' | 'deploy' | null} */
  let who = null;
  for (let i = 0; i < SSH_WAIT.tries && !who; i++) {
    if ((await remote(asRoot, ['true'])).code === 0) who = 'root';
    else if ((await remote(asDeploy, ['true'])).code === 0) who = 'deploy';
    else await clock.sleep(SSH_WAIT.everyMs);
  }
  if (!who) throw new Error(`вузол ${node.name} не приймає SSH`);

  if (who === 'root') {
    for (const id of ['deploy-user', 'node-dir']) {
      const s = ROOT_STEPS.find((x) => x.id === id);
      if (!s?.apply) throw new Error(`немає кроку bootstrap ${id}`);
      if ((await remote(asRoot, s.check(dir))).code === 0) continue;
      const r = await remote(asRoot, s.apply(dir), { input: s.input, timeoutMs: s.timeoutMs });
      if (r.code !== 0 || (await remote(asRoot, s.check(dir))).code !== 0) throw new Error(`${id} (${s.title}) для ${dir}: не вдалося (код ${r.code})`);
    }
  }

  const code = await runBootstrap({ ...ctx, args: { sub: 'bootstrap', env, values: { host: ip }, flags: {} } });
  if (code !== 0) throw new Error(`bootstrap вузла ${node.name} завершився з кодом ${code}`);

  const upload = ['sh', '-c', `set -e; umask 077; cat > "$1/${REALTIME_COMPOSE_FILE}.tmp"; mv "$1/${REALTIME_COMPOSE_FILE}.tmp" "$1/${REALTIME_COMPOSE_FILE}"`, '_', dir];
  const r = await remote(asDeploy, upload, { input: composeText });
  if (r.code !== 0) throw new Error(`${REALTIME_COMPOSE_FILE} у ${dir}: не записано (код ${r.code})`);
  ctx.out(`capacity: ${REALTIME_COMPOSE_FILE} записано в ${dir} (не запущено: токен тунелю realtime — П-RT)`);
}

/**
 * Інвентар: вузли, розміри з ціною за годину, дозволені розміри.
 * @param {OpsContext} ctx
 * @param {string} providerName
 * @param {string} env
 * @param {EnvSizes} envSizes
 * @param {Observed} seen
 * @param {Size[]} sizes
 * @param {(n: Node) => string} suspectLine
 */
function printInventory(ctx, providerName, env, envSizes, seen, sizes, suspectLine) {
  const { out } = ctx;
  out(`capacity ${env} plan (провайдер ${providerName}, регіон ${envSizes.region})`);
  out('вузли:');
  /** @param {Node} n @param {string} role */
  const row = (n, role) => out(`  ${n.name} — ${role}, ${n.size}, ${n.status}, ${n.publicIp ?? 'без адреси'}`);
  for (const n of seen.main) row(n, 'основний');
  for (const n of seen.realtime) row(n, 'realtime');
  for (const n of seen.other) row(n, 'без ролі');
  for (const n of seen.suspects) out(`  ${suspectLine(n)}`);
  if (!seen.main.length && !seen.realtime.length && !seen.other.length && !seen.suspects.length) out('  немає');
  out(`розміри (основний: дозволені ${envSizes.main.allowed.join(', ')}; поза сезоном ${envSizes.main.offSeason}; realtime ${envSizes.realtime.size}):`);
  const shown = new Set([...envSizes.main.allowed, envSizes.realtime.size]);
  for (const s of sizes.filter((x) => shown.has(x.slug))) {
    out(`  ${s.slug} — ${s.vcpus} vCPU, ${s.memoryMb} MB RAM, диск ${s.diskGb} GB — ${price(s.priceHourly)}`);
  }
  return 0;
}

/**
 * Розбіжність зі станом «поза сезоном» (AC-51), рядок за рядком.
 * @param {OpsContext} ctx
 * @param {string} env
 * @param {EnvSizes} envSizes
 * @param {Observed} seen
 * @param {(slug: string) => Size | undefined} sizeOf
 * @param {(n: Node) => string} suspectLine
 */
function printStatus(ctx, env, envSizes, seen, sizeOf, suspectLine) {
  const { out } = ctx;
  const off = envSizes.main.offSeason;
  /** @type {string[]} */
  const drift = [];
  if (!seen.main.length) drift.push('основного вузла немає');
  if (seen.main.length > 1) drift.push(`основних вузлів ${seen.main.length}: очікується один`);
  for (const n of seen.main) {
    if (n.size !== off) drift.push(`основний вузол ${n.name}: розмір ${n.size} (${price(sizeOf(n.size)?.priceHourly ?? 0)}), поза сезоном — ${off}`);
    if (n.status !== 'active') drift.push(`основний вузол ${n.name}: стан ${n.status}, очікується active`);
  }
  for (const n of seen.realtime) drift.push(`вузол realtime ${n.name} є (${n.size}, ${price(sizeOf(n.size)?.priceHourly ?? 0)}), поза сезоном його немає`);
  for (const n of seen.suspects) drift.push(suspectLine(n));
  out(`capacity ${env} status (поза сезоном: основний ${off}, без вузла realtime):`);
  if (!drift.length) out('  розбіжностей немає');
  for (const d of drift) out(`  ${d}`);
  return 0;
}
