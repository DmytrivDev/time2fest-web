// @ts-check
// `ops scheduler-drill` (SPEC-07 W56, AC-70…AC-72; рішення власника 2026-11-18 — два режими). Лише `rehearsal`.
// Два екземпляри сервера, одна оренда планувальника (рядок у Postgres). Навчання ставить віртуальний годинник на
// `--midnight` мінус хвилину, чекає, доки відомий власник оренди, рівно у віртуальну північ зупиняє його контейнер
// (`docker compose stop`), міряє реальний час до перехоплення іншим екземпляром і до запису опівнічних моментів
// (`clock records`), перевіряє, що кожна належна пара (дія, момент) записана рівно один раз, і друкує рядок
// `DRILL takeover_ms=<n> late_ms=<n> duplicates=<n> missed=<n>`. Відновлення — ЗАВЖДИ (finally): запуск зупиненого
// контейнера, `clock real`, прибирання екземпляра навчання; кожен крок — у журнал `.local/<env>/server2.jsonl`.
//   --mode one-node   — другий `server-drill` на тому самому вузлі (`node/compose.drill.yml`, профіль
//                       `scheduler-drill`, 640m); спершу перевірка MemAvailable (бракує — відмова з числом МБ).
//   --mode two-nodes  — другий екземпляр уже працює на тимчасовому вузлі (`server2 up`); навчання лише керує й міряє.
//                       Відмова, якщо `private-db` не відкрито саме для приватної адреси цього вузла або він нездоровий.
// Розмір вузла навчання не змінює ніколи (П3): `--resize` — відмова навіть із `--confirm-resize`.
// Коди: 0 — навчання пройшло (перехоплення ≤ 10 с, дублів і пропусків немає) і все відновлено; 2 — відмова до
// будь-якої зміни; 1 — крок не вдався, межу перевищено або відновлення неповне (рядок журналу `left`).
import fs from 'node:fs';
import path from 'node:path';
import { server2Dir } from './capacity/plan.mjs';
import { DEPLOY_USER, knownHostsFile, messageOf, resolveSite } from './common.mjs';
import { ENVS } from './config.mjs';
import { acquireNodeLock } from './lock.mjs';
import { composeArgv, COMPOSE_FILE, CURRENT_ENV } from './node.mjs';
import { drillJournal, openPeer, proxyContainers, readVpc } from './privateDb.mjs';
import { server2Project } from './server2.mjs';
import { checkTarget } from './target.mjs';

export const DRILL_COMPOSE = 'compose.drill.yml';
export const DRILL_SERVICE = 'server-drill';
export const DRILL_PROFILE = 'scheduler-drill';
/** `mem_limit` сервісу `server-drill` у `compose.drill.yml` (МіБ) і запас для решти вузла. */
export const DRILL_MEM_MB = 640;
export const MEM_MARGIN_MB = 128;
/** Віртуальний годинник ставиться на північ мінус стільки (реальний час на швидкості 1). */
export const LEAD_MS = 60_000;
/** Межа перехоплення (C6: строк оренди ~6 с, продовження ~2 с). */
export const TAKEOVER_LIMIT_MS = 10_000;
export const POLL_MS = 500;
const RECORDS_POLL_MS = 1_000;
const HOLDER_WAIT_MS = 60_000;
const TAKEOVER_WAIT_MS = 30_000;
const RECORDS_WAIT_MS = 60_000;
const HEALTH_WAIT_MS = 180_000;
const EDGE_WAIT_MS = 90_000;
const EDGE_EVERY_MS = 2_000;
/** Останнє читання власника — за стільки до півночі; менше часу в запасі — навчання не починає зупинку. */
const LAST_LOOK_MS = 3_000;
const CALL_TIMEOUT_MS = 60_000;
const STOP_TIMEOUT_MS = 120_000;
const RE_ID = /^[0-9a-f]{12,64}$/;
const RE_HOSTNAME = /^[A-Za-z0-9][A-Za-z0-9.-]{0,252}$/;
const INSPECT_FORMAT = '{{.Config.Hostname}}';

/**
 * @typedef {import('./exec.mjs').Transport} Transport
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 * @typedef {import('./node.mjs').Clock} Clock
 * @typedef {{
 *   name: 'main' | 'drill' | 'second',
 *   node: string,
 *   service: string,
 *   transport: Transport,
 *   compose: (args: string[]) => string[],
 *   publicApi: boolean,
 * }} Instance `publicApi` — за цим контейнером публічний `/api` (тунель основного вузла).
 * @typedef {{
 *   holder: string | null,
 *   epoch: number | null,
 *   runEpoch: number | null,
 *   nowMs: number | null,
 *   speed: number | null,
 *   frozen: boolean,
 *   next: { key: string, atMs: number, due: { action: string, key: string }[] | null } | null,
 * }} DrillStatus
 */

// ---------- чисті функції ----------

/**
 * `MemAvailable` з `/proc/meminfo`, МіБ (униз); немає — `null`.
 * @param {string} stdout
 */
export function parseMemAvailableMb(stdout) {
  const m = String(stdout).match(/^MemAvailable:\s+(\d+)\s+kB\s*$/m);
  return m ? Math.floor(Number(m[1]) / 1024) : null;
}

/** Скільки МіБ бракує екземпляру навчання (0 — досить). @param {number} availableMb */
export const memoryShortMb = (availableMb) => Math.max(0, DRILL_MEM_MB + MEM_MARGIN_MB - availableMb);

/**
 * Північ поясу: ціла хвилина, кратна 15 (пояси бувають +5:45, +12:45), без секунд.
 * @param {string} iso
 */
export function isZoneMidnight(iso) {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return false;
  const d = new Date(ms);
  return d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0 && d.getUTCMinutes() % 15 === 0;
}

/** ISO без нульових мілісекунд (як приймає `clock set --at`). @param {number} ms */
export const isoOf = (ms) => new Date(ms).toISOString().replace('.000Z', 'Z');

/** Мілісекунди з числа чи рядка ISO. @param {unknown} v */
const msOf = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? Date.parse(v) : null);
/** @param {unknown} v */
const intOf = (v) => (typeof v === 'number' && Number.isSafeInteger(v) ? v : null);
/** @param {unknown} v @returns {Record<string, unknown> | null} */
const objOf = (v) => (v !== null && typeof v === 'object' && !Array.isArray(v) ? /** @type {Record<string, unknown>} */ (v) : null);
/** Конверт `{ ok, value }` або сам об’єкт. @param {unknown} json */
const unwrap = (json) => {
  const o = objOf(json);
  return o && objOf(o.value) ? objOf(o.value) : o;
};

/**
 * Останній непорожній рядок stdout як JSON; не JSON — `null`.
 * @param {string} stdout
 */
export function lastJson(stdout) {
  const line = String(stdout).split(/\r?\n/).filter((l) => l.trim() !== '').at(-1);
  if (line === undefined) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

/**
 * Статус CLI годинника (`pnpm run clock status`): поля, на які покладається навчання. Чого немає — `null`.
 * @param {unknown} json
 * @returns {DrillStatus | null}
 */
export function parseStatus(json) {
  const v = unwrap(json);
  if (!v) return null;
  const lease = objOf(v.lease);
  const next = objOf(v.nextMoment);
  const nextAt = next ? msOf(next.at) : null;
  /** @type {{ action: string, key: string }[] | null} */
  let due = null;
  if (next && Array.isArray(next.due)) {
    due = next.due
      .map((p) => objOf(p))
      .filter((p) => p !== null && typeof p.action === 'string' && typeof p.key === 'string')
      .map((p) => ({ action: String(p?.action), key: String(p?.key) }));
  }
  return {
    holder: lease && typeof lease.holder === 'string' && lease.holder !== '' ? lease.holder : null,
    epoch: lease ? intOf(lease.epoch) : null,
    runEpoch: intOf(v.runEpoch),
    nowMs: msOf(v.now),
    speed: typeof v.speed === 'number' && Number.isFinite(v.speed) ? v.speed : null,
    frozen: v.frozen === true,
    next: next && typeof next.key === 'string' && nextAt !== null ? { key: next.key, atMs: nextAt, due } : null,
  };
}

/** Хост у `holder` (`<hostname>:<pid>:<hex>`, як `server/src/container.ts`). @param {string} holder */
export const holderHost = (holder) => String(holder).split(':')[0] ?? '';

/**
 * Пари (дія, ключ моменту) з виводу `clock records`: `{ epoch, records: [{ keys, action, … }] }` (чи конверт `value`).
 * @param {unknown} json
 * @returns {{ action: string, key: string }[] | null}
 */
export function recordPairs(json) {
  const v = unwrap(json);
  if (!v || !Array.isArray(v.records)) return null;
  /** @type {{ action: string, key: string }[]} */
  const out = [];
  for (const r of v.records) {
    const o = objOf(r);
    if (!o || typeof o.action !== 'string') continue;
    const keys = Array.isArray(o.keys) ? o.keys : typeof o.key === 'string' ? [o.key] : [];
    for (const k of keys) if (typeof k === 'string') out.push({ action: o.action, key: k });
  }
  return out;
}

/**
 * Підсумок записів: `missed` — належні пари без запису; `duplicates` — зайві записи будь-якої пари епохи.
 * Без переліку `due` належним вважається хоча б один запис ключа `key` (будь-яка дія).
 * @param {{ action: string, key: string }[]} pairs
 * @param {{ key: string, due: { action: string, key: string }[] | null }} expect
 */
export function tallyRecords(pairs, expect) {
  /** @type {Map<string, number>} */
  const count = new Map();
  for (const p of pairs) count.set(`${p.action}\u0000${p.key}`, (count.get(`${p.action}\u0000${p.key}`) ?? 0) + 1);
  let duplicates = 0;
  for (const n of count.values()) duplicates += Math.max(0, n - 1);
  const missed = expect.due
    ? expect.due.filter((d) => !count.has(`${d.action}\u0000${d.key}`)).length
    : pairs.some((p) => p.key === expect.key) ? 0 : 1;
  return { duplicates, missed };
}

/**
 * Реальний час (годинник оператора), коли віртуальний годинник дійде до `targetMs`.
 * @param {number} targetMs
 * @param {{ nowMs: number, speed: number }} status
 * @param {number} readAt реальний час читання статусу
 */
export const realTimeOf = (targetMs, status, readAt) => readAt + (targetMs - status.nowMs) / status.speed;

/**
 * Заміри з міток часу: `takeoverMs` — від початку зупинки власника до середини виклику статусу, що вперше показав
 * нового власника; `lateMs` — від реальної півночі до середини виклику записів, що вперше показав усі належні пари.
 * @param {{ stopAt: number, takeover: { start: number, end: number }, midnightAt: number, records: { start: number, end: number } }} t
 */
export function measure(t) {
  const mid = (/** @type {{ start: number, end: number }} */ c) => (c.start + c.end) / 2;
  return {
    takeoverMs: Math.max(0, Math.round(mid(t.takeover) - t.stopAt)),
    lateMs: Math.max(0, Math.round(mid(t.records) - t.midnightAt)),
  };
}

/** @param {{ takeoverMs: number, lateMs: number, duplicates: number, missed: number }} r */
export const drillLine = (r) => `DRILL takeover_ms=${r.takeoverMs} late_ms=${r.lateMs} duplicates=${r.duplicates} missed=${r.missed}`;

// ---------- екземпляри ----------

/**
 * @param {Instance} inst
 * @param {string[]} args
 * @param {number} [timeoutMs]
 */
const call = (inst, args, timeoutMs = CALL_TIMEOUT_MS) => {
  const argv = inst.compose(args);
  return inst.transport.exec(argv, { allow: [...argv], timeoutMs });
};

/**
 * Один виклик CLI годинника в контейнері екземпляра.
 * @param {Instance} inst
 * @param {string[]} cli
 */
async function clockCli(inst, cli) {
  const r = await call(inst, ['exec', '-T', inst.service, 'pnpm', 'run', 'clock', ...cli]);
  if (r.code !== 0) throw new Error(`clock ${cli[0]} у ${inst.name}: код ${r.code}`);
  const json = lastJson(r.stdout);
  if (json === null) throw new Error(`clock ${cli[0]} у ${inst.name}: CLI не повернув JSON-рядка`);
  return json;
}

/** @param {Instance} inst */
async function readStatus(inst) {
  const s = parseStatus(await clockCli(inst, ['status']));
  if (!s) throw new Error(`clock status у ${inst.name}: не об’єкт`);
  return s;
}

/** Одна перевірка здоров’я зсередини контейнера (`200 <commit>`). @param {Instance} inst */
async function healthy(inst) {
  try {
    const r = await call(inst, ['exec', '-T', inst.service, 'node', 'scripts/health-probe.mjs'], 15_000);
    return r.code === 0 && String(r.stdout).split(/\r?\n/).some((l) => /^200 \S+$/.test(l.trim()));
  } catch {
    return false;
  }
}

/** @param {Instance} inst @param {Clock} clock @param {number} limitMs */
async function waitHealthy(inst, clock, limitMs) {
  const until = clock.now() + limitMs;
  for (;;) {
    if (await healthy(inst)) return true;
    if (clock.now() + 1_000 > until) return false;
    await clock.sleep(1_000);
  }
}

/** Ім’я хоста контейнера екземпляра (`ps -q` → `docker inspect`). @param {Instance} inst */
async function hostnameOf(inst) {
  const ps = await call(inst, ['ps', '-q', inst.service]);
  const id = String(ps.stdout).split(/\s+/).find((x) => RE_ID.test(x));
  if (ps.code !== 0 || !id) throw new Error(`${inst.name}: контейнер ${inst.service} не знайдено`);
  const argv = ['docker', 'inspect', '--format', INSPECT_FORMAT, id];
  const r = await inst.transport.exec(argv, { allow: [...argv], timeoutMs: CALL_TIMEOUT_MS });
  const host = String(r.stdout).trim();
  if (r.code !== 0 || !RE_HOSTNAME.test(host)) throw new Error(`${inst.name}: ім’я хоста контейнера не прочитано`);
  return host;
}

// ---------- підкоманда ----------

/**
 * `ops scheduler-drill --env rehearsal --target <основний> --mode one-node|two-nodes [--second <хост>] --midnight <ISO>`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runSchedulerDrill(ctx) {
  const { err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const { mode, second, midnight } = ctx.args.values;
  /** @param {string} m */
  const refuse = (m) => {
    err(`scheduler-drill: ${m}`);
    return 2;
  };
  const cfg = ENVS[env];
  if (env !== 'rehearsal' || !cfg?.nodeDir || !cfg.siteHost) return refuse('лише --env rehearsal');
  if (ctx.args.flags.resize === true || ctx.args.flags['confirm-resize'] === true) {
    return refuse('навчання ніколи не змінює розмір вузла (П3), і --confirm-resize цього не дозволяє; збільшення — окремо `capacity --size …` після «так» власника');
  }
  if (mode === 'two-nodes' && !second) return refuse('--mode two-nodes: потрібен --second <адреса другого вузла>');
  if (mode === 'one-node' && second) return refuse('--mode one-node: --second не потрібен');
  if (!midnight || !isZoneMidnight(midnight)) return refuse('--midnight: має бути північ поясу (ціла хвилина, кратна 15, напр. 2026-12-31T10:00:00Z)');

  /** @type {string} */
  let drillText = '';
  if (mode === 'one-node') {
    try {
      drillText = fs.readFileSync(path.join(ctx.paths.examplesDir, DRILL_COMPOSE), 'utf8');
    } catch {
      return refuse(`немає ${DRILL_COMPOSE} у ${ctx.paths.examplesDir}`);
    }
  }

  // Другий вузол: та сама звірка цілі, що й `--target` (AC-22), до першого SSH.
  /** @type {Transport | null} */
  let t2 = null;
  if (mode === 'two-nodes') {
    const s = /** @type {string} */ (second);
    const checked = await checkTarget(s, ctx.deps);
    if (!checked.ok) return refuse(`--second: ${checked.message}`);
    if (!checked.address) return refuse('--second: адреса не IPv4');
    const target = ctx.args.values.target;
    if (s === target || checked.address === target) return refuse('--second: це той самий вузол, що --target');
    try {
      t2 = ctx.deps.transport({ host: checked.address, user: DEPLOY_USER, knownHostsFile: knownHostsFile(ctx), ...(checked.address !== s ? { hostKeyAlias: s } : {}) });
    } catch (e) {
      return refuse(messageOf(e));
    }
  }

  const resolved = resolveSite(ctx);
  if (resolved.code !== 0) return refuse(resolved.message);
  const site = resolved.site;
  if (site.transport.kind !== 'ssh' || !site.nodeDir || !site.project) return refuse('лише вузол (--target — адреса основного вузла)');
  const nodeDir = site.nodeDir;
  const where = { project: site.project, nodeDir, local: false };
  /** @type {Instance} */
  const main = { name: 'main', node: 'main', service: 'server', transport: site.transport, compose: (a) => composeArgv(where, CURRENT_ENV, a), publicApi: true };
  /** @type {Instance} */
  const other =
    mode === 'one-node'
      ? {
          name: 'drill',
          node: 'main',
          service: DRILL_SERVICE,
          transport: site.transport,
          compose: (a) => [
            'docker', 'compose', '-p', where.project,
            '-f', path.posix.join(nodeDir, COMPOSE_FILE), '-f', path.posix.join(nodeDir, DRILL_COMPOSE),
            '--env-file', path.posix.join(nodeDir, CURRENT_ENV), '--profile', DRILL_PROFILE, ...a,
          ],
          publicApi: false,
        }
      : (() => {
          const w2 = { project: server2Project(env), nodeDir: server2Dir(env), local: false };
          return { name: /** @type {const} */ ('second'), node: 'second', service: 'server', transport: /** @type {Transport} */ (t2), compose: (/** @type {string[]} */ a) => composeArgv(w2, CURRENT_ENV, a), publicApi: false };
        })();

  const lock = await acquireNodeLock(site.transport, env, site.lockOpts);
  if (lock.code !== 0) return refuse(lock.message);
  try {
    return await drill(ctx, { env, mode: /** @type {'one-node' | 'two-nodes'} */ (mode), midnightMs: Date.parse(midnight), main, other, nodeDir, drillText, siteHost: cfg.siteHost });
  } finally {
    await lock.release();
  }
}

/**
 * Перевірки (лише читання) → зміни → вимір; відновлення — у finally.
 * @param {OpsContext} ctx
 * @param {{ env: string, mode: 'one-node' | 'two-nodes', midnightMs: number, main: Instance, other: Instance, nodeDir: string, drillText: string, siteHost: string }} o
 */
async function drill(ctx, o) {
  const { out, err } = ctx;
  const clock = ctx.deps.clock;
  const { main, other, mode } = o;
  const journal = drillJournal(ctx, o.env, { sub: 'scheduler-drill', mode });
  /** @param {string} m */
  const refuse = (m) => {
    err(`scheduler-drill: ${m}`);
    journal.append({ step: 'precheck', result: 'refused', message: m });
    return 2;
  };

  // 1. Перевірки — нічого не змінюють.
  try {
    if (mode === 'one-node') {
      const r = await main.transport.exec(['cat', '/proc/meminfo'], { timeoutMs: CALL_TIMEOUT_MS });
      const avail = r.code === 0 ? parseMemAvailableMb(r.stdout) : null;
      if (avail === null) return refuse(`MemAvailable не прочитано (код ${r.code})`);
      const short = memoryShortMb(avail);
      if (short > 0) return refuse(`бракує ${short} МБ пам’яті: вільно ${avail} МБ, потрібно ${DRILL_MEM_MB + MEM_MARGIN_MB} МБ (${DRILL_MEM_MB} екземпляр + ${MEM_MARGIN_MB} запас); розмір вузла навчання не змінює`);
      out(`scheduler-drill: пам’ять — вільно ${avail} МБ, потрібно ${DRILL_MEM_MB + MEM_MARGIN_MB} МБ`);
    } else {
      const v = await readVpc(other.transport);
      if (!v.ok) return refuse(`другий вузол: ${v.message}`);
      const peer = await openPeer(main.transport, o.nodeDir);
      const proxy = await proxyContainers(main.transport, o.env);
      if (peer !== v.vpc.address || !proxy.length) return refuse(`private-db не відкрито для ${v.vpc.address} — спершу private-db --env ${o.env} --target <основний> open --peer ${v.vpc.address}`);
      if (!(await healthy(other))) return refuse('другий екземпляр нездоровий — спершу server2 up');
    }
    if (!(await healthy(main))) return refuse('сервер основного вузла нездоровий — навчання не починаю');
  } catch (e) {
    return refuse(messageOf(e));
  }

  // 2. Зміни. Усе, що змінено, фіксується тут — відновлення бачить лише це.
  /** @type {{ drill: boolean, clock: boolean, stopped: Instance[] }} */
  const touched = { drill: false, clock: false, stopped: [] };
  /** @type {number | null} */
  let outageAt = null;
  /** @type {{ takeoverMs: number, lateMs: number, duplicates: number, missed: number } | null} */
  let result = null;
  let failed = false;
  /** @param {string} step @param {Record<string, unknown>} [rec] */
  const ok = (step, rec = {}) => journal.append({ step, result: 'ok', ...rec });
  /** @param {string} m */
  const fail = (m) => {
    throw new Error(m);
  };

  try {
    if (mode === 'one-node') {
      touched.drill = true;
      const file = path.posix.join(o.nodeDir, DRILL_COMPOSE);
      const w = ['sh', '-c', 'umask 022 && cat > "$1.tmp" && mv "$1.tmp" "$1"', '_', file];
      const wr = await main.transport.exec(w, { input: o.drillText, allow: [...w], timeoutMs: CALL_TIMEOUT_MS });
      if (wr.code !== 0) fail(`${DRILL_COMPOSE}: запис завершився з кодом ${wr.code}`);
      const up = await call(other, ['up', '-d', '--no-deps', DRILL_SERVICE], STOP_TIMEOUT_MS);
      if (up.code !== 0) fail(`${DRILL_SERVICE} не піднявся (код ${up.code})`);
      if (!(await waitHealthy(other, clock, HEALTH_WAIT_MS))) fail(`${DRILL_SERVICE} не здоровий за ${HEALTH_WAIT_MS / 1000} с`);
      ok('drill-up', { service: DRILL_SERVICE, mem_limit_mb: DRILL_MEM_MB });
      out(`scheduler-drill: ${DRILL_SERVICE} здоровий (640m, без портів)`);
    }

    const hosts = { main: await hostnameOf(main), other: await hostnameOf(other) };
    /** @param {string | null} holder @returns {Instance | null} */
    const owner = (holder) => (holder === null ? null : holderHost(holder) === hosts.main ? main : holderHost(holder) === hosts.other ? other : null);
    /** @param {Instance} via @param {(s: DrillStatus, who: Instance | null) => boolean} until @param {number} limitMs */
    const pollStatus = async (via, until, limitMs) => {
      const deadline = clock.now() + limitMs;
      for (;;) {
        const start = clock.now();
        const s = await readStatus(via).catch(() => null);
        const end = clock.now();
        if (s && until(s, owner(s.holder))) return { s, start, end };
        if (end >= deadline) return null;
        await clock.sleep(Math.max(0, POLL_MS - (end - start)));
      }
    };

    // Власник оренди відомий (будь-який із двох).
    let seen = await pollStatus(main, (_, who) => who !== null, HOLDER_WAIT_MS);
    if (!seen) fail(`власник оренди не з’явився за ${HOLDER_WAIT_MS / 1000} с (екземпляри: ${hosts.main}, ${hosts.other})`);
    // Два вузли: навчання доводить перехоплення ДРУГИМ вузлом — власником має бути основний.
    if (mode === 'two-nodes' && seen?.s && owner(seen.s.holder) === other) {
      touched.stopped.push(other);
      const r = await call(other, ['restart', other.service], STOP_TIMEOUT_MS);
      if (r.code !== 0) fail(`перезапуск другого екземпляра завершився з кодом ${r.code}`);
      seen = await pollStatus(main, (_, who) => who === main, HOLDER_WAIT_MS);
      if (!seen) fail('після перезапуску другого екземпляра оренду не взяв основний');
      if (!(await waitHealthy(other, clock, HEALTH_WAIT_MS))) fail('другий екземпляр не здоровий після перезапуску');
      ok('prefer-main', { restarted: other.name });
      out('scheduler-drill: оренду передано основному вузлу (другий екземпляр перезапущено один раз)');
    }

    // Годинник: нова епоха прогону, північ мінус хвилина, швидкість 1.
    touched.clock = true;
    await clockCli(main, ['restart-night']);
    await clockCli(main, ['set', '--at', isoOf(o.midnightMs - LEAD_MS)]);
    // Мітка читання — середина виклику (стан прочитано десь між початком і кінцем).
    const timedStatus = async () => {
      const start = clock.now();
      const s = await readStatus(main);
      return { s, at: (start + clock.now()) / 2 };
    };
    let { s: st, at: readAt } = await timedStatus();
    if (st.frozen || st.speed !== 1) {
      await clockCli(main, ['speed', '1']);
      ({ s: st, at: readAt } = await timedStatus());
    }
    if (st.frozen || st.speed !== 1 || st.nowMs === null || st.runEpoch === null) fail('годинник не йде зі швидкістю 1 після set/speed (status: frozen, speed, now, runEpoch)');
    if (!st.next || st.next.atMs !== o.midnightMs) fail(`наступний момент не на ${isoOf(o.midnightMs)} (nextMoment: ${st.next ? isoOf(st.next.atMs) : 'немає'}) — обрано не північ поясу`);
    const next = /** @type {NonNullable<DrillStatus['next']>} */ (st.next);
    const runEpoch = /** @type {number} */ (st.runEpoch);
    const midnightAt = realTimeOf(o.midnightMs, { nowMs: /** @type {number} */ (st.nowMs), speed: 1 }, readAt);
    ok('clock-set', { at: isoOf(o.midnightMs - LEAD_MS), midnight: isoOf(o.midnightMs), runEpoch, moment: next.key, due: next.due?.length ?? null });

    // Останній погляд на власника — за кілька секунд до півночі.
    await clock.sleep(Math.max(0, midnightAt - LAST_LOOK_MS - clock.now()));
    const last = await readStatus(main);
    const holder = owner(last.holder);
    if (!holder || last.epoch === null) fail('власник оренди перед північчю невідомий');
    const h = /** @type {Instance} */ (holder);
    if (mode === 'two-nodes' && h !== main) fail('перед північчю оренда не в основного вузла');
    const survivor = h === main ? other : main;
    const oldEpoch = /** @type {number} */ (last.epoch);
    ok('holder', { holder: h.name, epoch: oldEpoch });
    if (clock.now() > midnightAt) fail('північ минула до зупинки — запасу часу забракло');
    await clock.sleep(Math.max(0, midnightAt - clock.now()));

    // Північ: зупинка власника.
    const stopAt = clock.now();
    touched.stopped.push(h);
    if (h.publicApi) {
      outageAt = stopAt;
      journal.append({ step: 'outage', result: 'started', public_api: 'down', reason: `зупинено ${h.name}/${h.service} (власник оренди)` });
      out(`scheduler-drill: УВАГА — публічний /api недоступний, доки ${h.service} основного вузла не запуститься знову`);
    }
    const stop = await call(h, ['stop', h.service], STOP_TIMEOUT_MS);
    if (stop.code !== 0) fail(`зупинка ${h.name} завершилася з кодом ${stop.code}`);
    ok('stop', { instance: h.name, stop_ms: clock.now() - stopAt });

    // Перехоплення.
    const taken = await pollStatus(survivor, (s, who) => who === survivor && s.epoch !== null && s.epoch > oldEpoch, TAKEOVER_WAIT_MS);
    if (!taken) fail(`${survivor.name} не взяв оренду за ${TAKEOVER_WAIT_MS / 1000} с`);
    const tk = /** @type {NonNullable<typeof taken>} */ (taken);
    ok('takeover', { by: survivor.name, epoch: tk.s.epoch, poll_ms: tk.end - tk.start });

    // Записи опівнічних моментів.
    const expect = { key: next.key, due: next.due };
    const deadline = clock.now() + RECORDS_WAIT_MS;
    /** @type {{ start: number, end: number, pairs: { action: string, key: string }[] } | null} */
    let rec = null;
    for (;;) {
      const start = clock.now();
      const pairs = recordPairs(await clockCli(survivor, ['records', '--epoch', String(runEpoch)]).catch(() => null));
      const end = clock.now();
      if (pairs) {
        rec = { start, end, pairs };
        if (tallyRecords(pairs, expect).missed === 0) break;
      }
      if (end >= deadline) break;
      await clock.sleep(Math.max(0, RECORDS_POLL_MS - (end - start)));
    }
    if (!rec) fail(`clock records не повернув записів епохи ${runEpoch}`);
    const rc = /** @type {NonNullable<typeof rec>} */ (rec);
    const m = measure({ stopAt, takeover: tk, midnightAt, records: rc });
    result = { ...m, ...tallyRecords(rc.pairs, expect) };
    ok('result', { ...result, holder: h.name, by: survivor.name });
    out(drillLine(result));
    out(`T2F_MEASURE ${JSON.stringify({ metric: 'lease-takeover-ms', n: 1, p50: result.takeoverMs, p99: result.takeoverMs, max: result.takeoverMs })}`);
  } catch (e) {
    failed = true;
    err(`scheduler-drill: ${messageOf(e)}`);
    journal.append({ step: 'drill', result: 'failed', message: messageOf(e) });
  } finally {
    const left = await restore(ctx, { ...o, touched, journal, clock, outageAt });
    if (left.length) {
      failed = true;
      err(`scheduler-drill: відновлено НЕ все — лишилося: ${left.join('; ')}`);
    } else {
      out('scheduler-drill: відновлено — зупинений сервер працює, годинник реальний, екземпляр навчання прибрано, /api здоровий');
    }
  }
  if (failed || !result) return 1;
  if (result.takeoverMs > TAKEOVER_LIMIT_MS || result.duplicates > 0 || result.missed > 0) {
    err(`scheduler-drill: межі порушено (перехоплення ≤ ${TAKEOVER_LIMIT_MS} мс, дублів 0, пропусків 0)`);
    return 1;
  }
  return 0;
}

/**
 * Відновлення: зупинений сервер угору (до здоров’я), `clock real`, прибирання `server-drill`, `/api` через край.
 * Кожен крок пробується незалежно від попереднього; повертає перелік того, що лишилося.
 * @param {OpsContext} ctx
 * @param {{
 *   main: Instance, other: Instance, mode: 'one-node' | 'two-nodes', nodeDir: string, siteHost: string,
 *   touched: { drill: boolean, clock: boolean, stopped: Instance[] },
 *   journal: ReturnType<typeof drillJournal>, clock: Clock, outageAt: number | null,
 * }} o
 * @returns {Promise<string[]>}
 */
async function restore(ctx, o) {
  const { out } = ctx;
  const { journal, clock, touched } = o;
  /** @type {string[]} */
  const left = [];
  /** @param {string} step @param {boolean} good @param {Record<string, unknown>} [rec] */
  const note = (step, good, rec = {}) => journal.append({ step, result: good ? 'ok' : 'failed', ...rec });

  // Екземпляр навчання не запускаємо — його приберуть нижче. Основний (публічний /api) — першим.
  const toStart = [...new Set(touched.stopped)].filter((i) => i.name !== 'drill').sort((a, b) => Number(b.publicApi) - Number(a.publicApi));
  for (const inst of toStart) {
    let good = false;
    try {
      const r = await call(inst, ['start', inst.service], STOP_TIMEOUT_MS);
      good = r.code === 0 && (await waitHealthy(inst, clock, HEALTH_WAIT_MS));
    } catch {
      good = false;
    }
    note('restore-start', good, { instance: inst.name });
    if (!good) left.push(`${inst.name}: ${inst.service} не запущено чи нездоровий`);
    if (inst.publicApi && o.outageAt !== null) {
      journal.append({ step: 'outage', result: good ? 'ended' : 'continues', public_api: good ? 'up' : 'down', outage_ms: good ? clock.now() - o.outageAt : null });
      if (good) out(`scheduler-drill: публічний /api знову працює (простій ~${Math.round((clock.now() - o.outageAt) / 1000)} с)`);
    }
  }

  if (touched.clock) {
    let good = false;
    for (const inst of [o.main, o.other]) {
      try {
        await clockCli(inst, ['real']);
        good = true;
        break;
      } catch {
        // наступний екземпляр
      }
    }
    note('restore-clock', good, { action: 'real' });
    if (!good) left.push('годинник віртуальний — clock real не виконано');
  }

  if (touched.drill) {
    let good = false;
    try {
      const r = await call(o.other, ['rm', '-sf', DRILL_SERVICE], STOP_TIMEOUT_MS);
      const argv = ['sh', '-c', 'rm -f -- "$1"', '_', path.posix.join(o.nodeDir, DRILL_COMPOSE)];
      const f = await o.main.transport.exec(argv, { allow: [...argv], timeoutMs: CALL_TIMEOUT_MS });
      good = r.code === 0 && f.code === 0;
    } catch {
      good = false;
    }
    note('restore-drill', good, { service: DRILL_SERVICE });
    if (!good) left.push(`${DRILL_SERVICE} не прибрано`);
  }

  // Публічний сервер основного вузла — через край, як зонд розгортання.
  const url = `https://${o.siteHost}/api/health`;
  const until = clock.now() + EDGE_WAIT_MS;
  let edge = false;
  for (;;) {
    edge = await ctx.deps.edgeCheck(url).catch(() => false);
    if (edge || clock.now() + EDGE_EVERY_MS > until) break;
    await clock.sleep(EDGE_EVERY_MS);
  }
  note('public-health', edge, { url });
  if (!edge) left.push(`${url} не відповідає 200`);
  journal.append({ step: 'restore', result: left.length ? 'failed' : 'ok', left });
  return left;
}
