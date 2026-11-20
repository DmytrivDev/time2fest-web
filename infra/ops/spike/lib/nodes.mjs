// @ts-check
// Вузли спайку в провайдера: план із цінами, створення з тегами й підготовкою по SSH, стан (вік, вартість, запас до
// межі 6 год), видалення лише вузлів з ОБОМА тегами `t2f-managed` і `t2f-env-spike` (адаптер перевіряє теги ще раз у
// момент видалення). Основний вузол (`t2f-env-rehearsal`, `t2f-role-main`) і будь-що без тегу спайку не зачіпаються.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { checkTimeSync, ROOT_STEPS } from '../../lib/bootstrap.mjs';
import { CENTRIFUGO_REDIS_BASE, redisUrl } from '../../lib/secrets/envFile.mjs';
import { isForbiddenAddress } from '../../lib/target.mjs';
import { COMPOSE_FILE, FILES, K6_IMAGE, NODE_DIR, NODES, REQUIRED_TAGS, ROLE_TAGS, TAG_ENV, TAG_MANAGED } from './config.mjs';
import { journal } from './journal.mjs';
import { buildPlan, lifetime, usd } from './plan.mjs';

/**
 * @typedef {import('../../lib/capacity/provider.mjs').Provider} Provider
 * @typedef {import('../../lib/capacity/provider.mjs').Node} Node
 * @typedef {import('../../lib/exec.mjs').Transport} Transport
 * @typedef {{
 *   out: (l: string) => void,
 *   err: (l: string) => void,
 *   now: () => Date,
 *   sleep: (ms: number) => Promise<void>,
 *   stateDir: string,
 *   redactor: { add: (v: string | undefined | null) => void, contains: (t: string) => boolean },
 *   provider: () => Promise<Provider>,
 *   sshAs: (o: { host: string, user: string, knownHostsFile: string }) => Transport,
 * }} NodeCtx
 */

export const SYSCTL_FILE = '/etc/sysctl.d/99-t2f-spike.conf';
export const SYSCTL_CONF =
  'net.ipv4.ip_local_port_range = 1024 65000\n' +
  'fs.file-max = 2097152\n' +
  'fs.nr_open = 2097152\n' +
  'net.core.somaxconn = 65535\n' +
  'net.ipv4.tcp_max_syn_backlog = 65535\n' +
  'net.core.netdev_max_backlog = 65535\n' +
  'net.ipv4.tcp_tw_reuse = 1\n';
export const LIMITS_FILE = '/etc/security/limits.d/99-t2f-spike.conf';
export const LIMITS_LINES = ['* soft nofile 1048576', '* hard nofile 1048576', 'root soft nofile 1048576', 'root hard nofile 1048576'];
const APT_TIMEOUT_MS = 15 * 60_000;
const SSH_WAIT = { tries: 60, everyMs: 5_000 };

/** @param {string} script @returns {(dir: string) => string[]} */
const sh = (script) => (dir) => ['sh', '-c', script, '_', dir];
/** @param {string} id */
const rootStep = (id) => {
  const s = ROOT_STEPS.find((x) => x.id === id);
  if (!s) throw new Error(`немає кроку bootstrap ${id}`);
  return s;
};

/**
 * Кроки підготовки (check → apply), повтор безпечний. Спільні + за роллю.
 * @param {'realtime' | 'loadgen'} role
 * @returns {import('../../lib/bootstrap.mjs').Step[]}
 */
export function provisionSteps(role) {
  /** @type {import('../../lib/bootstrap.mjs').Step[]} */
  const common = [
    {
      id: 'docker',
      title: 'Docker і Compose з архіву Ubuntu',
      check: sh('docker --version >/dev/null 2>&1 && docker compose version >/dev/null 2>&1'),
      apply: sh('set -e; export DEBIAN_FRONTEND=noninteractive; apt-get update; apt-get install -y docker.io docker-compose-v2'),
      timeoutMs: APT_TIMEOUT_MS,
    },
    rootStep('firewall'),
    rootStep('time-sync'),
    {
      id: 'sysctl',
      title: 'sysctl: порти 1024–65000, файли, черги; nofile',
      check: sh(`test -f ${SYSCTL_FILE} && test -f ${LIMITS_FILE} && test "$(sysctl -n net.ipv4.ip_local_port_range | tr -s '\\t ' ' ')" = "1024 65000"`),
      apply: sh(
        `set -e; umask 022; cat > ${SYSCTL_FILE}.tmp; mv ${SYSCTL_FILE}.tmp ${SYSCTL_FILE}; sysctl -q -p ${SYSCTL_FILE}; ` +
          `printf '%s\\n' ${LIMITS_LINES.map((l) => `'${l}'`).join(' ')} > ${LIMITS_FILE}`,
      ),
      input: SYSCTL_CONF,
    },
    {
      id: 'spike-dir',
      title: `каталог ${NODE_DIR}`,
      check: sh('test -d "$1/out" && test -d "$1/k6" && test -d "$1/collector"'),
      apply: sh('set -e; install -d -m 700 "$1"; install -d -m 700 "$1/k6" "$1/collector"; install -d -m 777 "$1/out"'),
    },
  ];
  if (role === 'loadgen') {
    return [
      ...common,
      {
        id: 'k6-image',
        title: `образ ${K6_IMAGE}`,
        check: () => ['docker', 'image', 'inspect', K6_IMAGE],
        apply: () => ['docker', 'pull', K6_IMAGE],
        timeoutMs: APT_TIMEOUT_MS,
      },
    ];
  }
  return common;
}

/**
 * @param {Transport} t
 * @param {string[]} argv
 * @param {{ input?: string, timeoutMs?: number }} [o]
 */
const remote = (t, argv, o = {}) => t.exec(argv, { allow: [...argv], timeoutMs: o.timeoutMs ?? 120_000, ...(o.input !== undefined ? { input: o.input } : {}) });

/**
 * Свіжі ключі спайку (локально, `infra/ops/.local/spike/`, 600): пароль Redis, HMAC токенів, ключ API. Наявні файли
 * не перезаписуються (повтор `create` дає ті самі значення). Значення реєструються в редакторі, не друкуються.
 * @param {string} stateDir
 * @param {NodeCtx['redactor']} redactor
 * @returns {{ 'redis.env': string, 'centrifugo.env': string }}
 */
export function ensureSpikeSecrets(stateDir, redactor) {
  fs.mkdirSync(stateDir, { recursive: true });
  const rnd = () => crypto.randomBytes(32).toString('hex');
  const redisFile = path.join(stateDir, 'redis.env');
  const centFile = path.join(stateDir, 'centrifugo.env');
  if (!fs.existsSync(redisFile) || !fs.existsSync(centFile)) {
    const pw = rnd();
    fs.writeFileSync(redisFile, `REDIS_PASSWORD=${pw}\n`, { mode: 0o600 });
    fs.writeFileSync(
      centFile,
      `CENTRIFUGO_CLIENT_TOKEN_HMAC_SECRET_KEY=${rnd()}\nCENTRIFUGO_HTTP_API_KEY=${rnd()}\nCENTRIFUGO_ENGINE_REDIS_ADDRESS=${redisUrl(CENTRIFUGO_REDIS_BASE, pw)}\n`,
      { mode: 0o600 },
    );
  }
  const text = { 'redis.env': fs.readFileSync(redisFile, 'utf8'), 'centrifugo.env': fs.readFileSync(centFile, 'utf8') };
  for (const t of Object.values(text)) for (const line of t.split(/\r?\n/)) redactor.add(line.split('=').slice(1).join('='));
  return text;
}

/** Роль вузла за тегом. @param {Node} n @returns {'realtime' | 'loadgen' | null} */
export const roleOf = (n) => (n.tags.includes(ROLE_TAGS.realtime) ? 'realtime' : n.tags.includes(ROLE_TAGS.loadgen) ? 'loadgen' : null);

/**
 * Вузли спайку з обома тегами; окремо — вузли з тегом середовища без `t2f-managed` (не чіпаються).
 * @param {Provider} p
 */
export async function spikeNodes(p) {
  const env = await p.listNodes([TAG_ENV]);
  const ours = env.filter((n) => n.tags.includes(TAG_MANAGED));
  return { ours, suspects: env.filter((n) => !n.tags.includes(TAG_MANAGED)) };
}

/** @param {NodeCtx} ctx */
export const knownHosts = (ctx) => path.join(ctx.stateDir, 'known_hosts');

/**
 * `plan`: лише читання — розміри й ціни з API, план, відмова за ціною.
 * @param {NodeCtx} ctx
 * @param {{ generators: number }} o
 */
export async function cmdPlan(ctx, o) {
  const p = await ctx.provider();
  const plan = buildPlan(await p.sizes(), { generators: o.generators });
  ctx.out(`spike plan: ${plan.rows.length} вузлів, теги ${TAG_MANAGED}, ${TAG_ENV}, роль`);
  for (const r of plan.rows) {
    ctx.out(`  ${r.name} — ${r.role === 'realtime' ? 'realtime' : 'генератор'}, ${r.size}, ${r.region}, ${usd(r.priceHourly)}/год (план ${usd(r.planPrice)}), очік. ${r.hours} год`);
  }
  ctx.out(`  разом ${usd(plan.perHour)}/год; очікувано ${usd(plan.expected)} за вузли; стеля — 6 год життя, $8 (трафік понад пул — до $2.50 оцінка)`);
  for (const r of plan.refusals) ctx.err(`spike plan: ВІДМОВА: ${r}`);
  return { code: plan.refusals.length ? 2 : 0, plan };
}

/**
 * `create --confirm spike`: створює відсутні вузли плану й готує всі (повтор безпечний).
 * @param {NodeCtx} ctx
 * @param {{ generators: number, composeText: string }} o
 */
export async function cmdCreate(ctx, o) {
  const { out, err } = ctx;
  const p = await ctx.provider();
  const plan = buildPlan(await p.sizes(), { generators: o.generators });
  if (plan.refusals.length) {
    for (const r of plan.refusals) err(`spike create: ВІДМОВА: ${r}`);
    return 2;
  }
  const secrets = ensureSpikeSecrets(ctx.stateDir, ctx.redactor);
  const { ours, suspects } = await spikeNodes(p);
  for (const s of suspects) err(`spike create: ${s.name} має ${TAG_ENV}, але не ${TAG_MANAGED} — не чіпаю`);
  /** @type {{ node: Node, role: 'realtime' | 'loadgen' }[]} */
  const fleet = [];
  for (const r of plan.rows) {
    let node = ours.find((n) => n.name === r.name);
    if (node) {
      if (roleOf(node) !== r.role) {
        err(`spike create: ${node.name} уже є з іншою роллю — відмова`);
        return 2;
      }
      out(`spike create: ${node.name} уже є (${node.size}, ${node.publicIp ?? 'без адреси'})`);
    } else {
      node = await p.createNode({ name: r.name, region: r.region, size: r.size, tags: [TAG_MANAGED, TAG_ENV, ROLE_TAGS[r.role]] });
      journal(ctx.stateDir, ctx.redactor, ctx.now(), 'create', 'node', 'ok', { node: node.name, nodeId: node.id, size: r.size, region: r.region, priceHourly: r.priceHourly });
      out(`spike create: ${node.name} створено (${r.size}, ${r.region}, ${node.publicIp ?? 'без адреси'})`);
    }
    fleet.push({ node, role: r.role });
  }
  const results = await Promise.allSettled(fleet.map((f) => provision(ctx, f.node, f.role, { composeText: o.composeText, secrets })));
  let code = 0;
  results.forEach((r, i) => {
    const name = fleet[i]?.node.name ?? '?';
    const ok = r.status === 'fulfilled';
    if (!ok) {
      err(`spike create: ${name}: підготовка не вдалася: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`);
      code = 1;
    }
    journal(ctx.stateDir, ctx.redactor, ctx.now(), 'create', 'provision', ok ? 'ok' : 'failed', { node: name });
  });
  if (code === 0) out('spike create: усі вузли готові; далі — cf-up --confirm spike');
  return code;
}

/**
 * Підготовка одного вузла по SSH (root).
 * @param {NodeCtx} ctx
 * @param {Node} node
 * @param {'realtime' | 'loadgen'} role
 * @param {{ composeText: string, secrets: Record<string, string> }} o
 */
export async function provision(ctx, node, role, o) {
  const ip = node.publicIp;
  if (!ip) throw new Error('немає публічної адреси');
  if (isForbiddenAddress(ip)) throw new Error(`заборонена ціль ${ip}`);
  const t = ctx.sshAs({ host: ip, user: 'root', knownHostsFile: knownHosts(ctx) });
  /** @param {string} l */
  const say = (l) => ctx.out(`${node.name}: ${l}`);
  let up = false;
  for (let i = 0; i < SSH_WAIT.tries && !up; i++) {
    up = (await remote(t, ['true'])).code === 0;
    if (!up) await ctx.sleep(SSH_WAIT.everyMs);
  }
  if (!up) throw new Error('не приймає SSH');
  for (const s of provisionSteps(role)) {
    const check = s.check(NODE_DIR);
    const passed = async () => {
      const r = await remote(t, check);
      return s.ok ? s.ok(r) : r.code === 0;
    };
    if (await passed()) continue;
    if (!s.apply) throw new Error(`${s.id}: не готово`);
    const r = await remote(t, s.apply(NODE_DIR), { input: s.input, timeoutMs: s.timeoutMs });
    if (r.code !== 0 || !(await passed())) throw new Error(`${s.id} (${s.title}): не вдалося (код ${r.code})`);
    say(`${s.title} — готово`);
  }
  const offsetOk = await checkTimeSync(t, { out: say, err: say }, 'час');
  if (!offsetOk) throw new Error('годинник не синхронізовано');
  if (role === 'realtime') {
    /** @param {string} rel @param {string} text */
    const put = async (rel, text) => {
      const r = await remote(t, ['sh', '-c', 'set -e; umask 077; cat > "$1.tmp"; mv "$1.tmp" "$1"', '_', `${NODE_DIR}/${rel}`], { input: text });
      if (r.code !== 0) throw new Error(`${rel}: не записано`);
    };
    await put(COMPOSE_FILE, o.composeText);
    await put('redis.env', o.secrets['redis.env'] ?? '');
    await put('centrifugo.env', o.secrets['centrifugo.env'] ?? '');
    await put('collector/rtspike-collector.sh', fs.readFileSync(FILES.collector, 'utf8').replace(/\r\n/g, '\n'));
    // Заглушки, щоб Compose розбирав проєкт до cf-up / першого run (токен пише лише cf-up).
    for (const f of ['cloudflared.env', 'publisher.env']) {
      await remote(t, ['sh', '-c', 'umask 077; [ -f "$1" ] || : > "$1"', '_', `${NODE_DIR}/${f}`]);
    }
    const compose = ['docker', 'compose', '-p', 't2f-spike', '-f', `${NODE_DIR}/${COMPOSE_FILE}`, '--project-directory', NODE_DIR];
    const pull = await remote(t, [...compose, '--profile', 'run', 'pull', '--quiet'], { timeoutMs: APT_TIMEOUT_MS });
    if (pull.code !== 0) throw new Error(`образи не завантажено (код ${pull.code})`);
    const upr = await remote(t, [...compose, 'up', '-d', 'redis', 'centrifugo'], { timeoutMs: APT_TIMEOUT_MS });
    if (upr.code !== 0) throw new Error(`redis/centrifugo не запущено (код ${upr.code})`);
    say('redis і centrifugo запущено (cloudflared — після cf-up)');
  }
  say('готово');
}

/**
 * `status`: вузли з тегом спайку, вік, вартість, запас до 6 год.
 * @param {NodeCtx} ctx
 */
export async function cmdStatus(ctx) {
  const p = await ctx.provider();
  const { ours, suspects } = await spikeNodes(p);
  const lt = lifetime(ours, await p.sizes(), ctx.now().getTime());
  ctx.out(`spike status: вузлів ${ours.length}`);
  for (const r of lt.rows) {
    ctx.out(`  ${r.node.name} — ${roleOf(r.node) ?? 'без ролі'}, ${r.node.size}, ${r.node.status}, ${r.node.publicIp ?? '—'}, вік ${r.ageHours === null ? '?' : r.ageHours.toFixed(2)} год, ${usd(r.cost)}`);
  }
  for (const s of suspects) ctx.out(`  ${s.name}: тег ${TAG_ENV} без ${TAG_MANAGED} — не чіпаю`);
  ctx.out(`  витрачено ≈ ${usd(lt.costSoFar)}, ${usd(lt.perHour)}/год; до межі 6 год лишилося ${ours.length ? `${lt.hoursLeft.toFixed(2)} год` : '—'}`);
  return { code: 0, nodes: ours, lifetime: lt };
}

/**
 * `delete --confirm spike`: лише вузли з обома тегами (адаптер перевіряє їх ще раз перед видаленням), потім — що лишилося.
 * @param {NodeCtx} ctx
 */
export async function cmdDelete(ctx) {
  const p = await ctx.provider();
  const { ours, suspects } = await spikeNodes(p);
  let code = 0;
  for (const n of ours) {
    if (!REQUIRED_TAGS.every((t) => n.tags.includes(t))) continue;
    try {
      await p.deleteNode(n.id, { requireTags: [...REQUIRED_TAGS] });
      journal(ctx.stateDir, ctx.redactor, ctx.now(), 'delete', 'node', 'ok', { node: n.name, nodeId: n.id });
      ctx.out(`spike delete: ${n.name} видалено`);
      forgetHost(ctx, n.publicIp);
    } catch (e) {
      code = 1;
      journal(ctx.stateDir, ctx.redactor, ctx.now(), 'delete', 'node', 'failed', { node: n.name, nodeId: n.id });
      ctx.err(`spike delete: ${n.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  const left = await spikeNodes(p);
  ctx.out(`spike delete: лишилося вузлів спайку ${left.ours.length}${left.ours.length ? `: ${left.ours.map((n) => n.name).join(', ')}` : ''}`);
  for (const s of [...suspects, ...left.suspects.filter((x) => !suspects.some((y) => y.id === x.id))]) ctx.out(`  ${s.name}: тег ${TAG_ENV} без ${TAG_MANAGED} — не чіпав`);
  return left.ours.length ? 1 : code;
}

/**
 * Прибрати адресу видаленого вузла з `known_hosts` спайку (провайдер може віддати її іншому вузлу).
 * @param {NodeCtx} ctx
 * @param {string | null} ip
 */
function forgetHost(ctx, ip) {
  if (!ip) return;
  const f = knownHosts(ctx);
  try {
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    fs.writeFileSync(f, lines.filter((l) => !(l.split(' ')[0] ?? '').split(',').includes(ip)).join('\n'), { mode: 0o600 });
  } catch {
    /* файла немає */
  }
}

export { NODES };
