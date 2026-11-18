// @ts-check
// Перенесення імені між Worker’ами (AC-33, AC-34): `ops move-domain --name <host> --to <worker>`.
// Перенесення — це не-інтерактивний `wrangler deploy` цільового Worker’а з тим самим Custom Domain (wrangler сам
// ставить `override_existing_origin`). Зонд кожну секунду GET `https://<name>/` від 5 с до й 30 с після розгортання
// міряє проміжок і фіксує, хто відповів (`x-t2f-twin`). Явне від’єднання — запасний шлях при конфлікті
// й лише для прив’язки, яку журнал записав як створену цією командою; робочі хости — ніколи.
// Перед розгортанням Worker’а робочого домену — та сама перевірка тримача, що в `deploy` (N2): Worker, з якого
// журнал переносить ім’я, дозволений сам; запис DNS старого сайту — лише з явним `--take-domain-from dns`.
// Токен і ідентифікатор акаунта — лише з середовища (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { cloudflareApiFrom } from './cloudflareApi.mjs';
import { messageOf } from './common.mjs';
import { ENVS, MAIN_HOSTS, REPO_ROOT } from './config.mjs';
import { checkDomainHolders } from './domainHolder.mjs';
import { EDGE_DIR, WRANGLER_JS } from './worker.mjs';

export const TWIN_WORKER = 't2f-edge-rehearsal-alt';
export const TWIN_MAIN = path.join(REPO_ROOT, 'infra', 'ops', 'edge-twin', 'worker.mjs');
/** Ім’я репетиції — те саме, що `ENVS.rehearsal.siteHost`. */
export const REHEARSAL_NAME = /** @type {string} */ (ENVS.rehearsal.siteHost);
export const EDGE_JOURNAL = 'edge.jsonl';
const DEPLOY_TIMEOUT_MS = 10 * 60_000;
export const PROBE_BEFORE_MS = 5_000;
export const PROBE_AFTER_MS = 30_000;
/** Дозволені Worker’и: назва → середовище wrangler (двійник — без середовища). */
const WORKERS = /** @type {Record<string, { workerEnv: string | null }>} */ ({
  't2f-edge-rehearsal': { workerEnv: 'rehearsal' },
  [TWIN_WORKER]: { workerEnv: null },
  't2f-edge-prelaunch': { workerEnv: 'prelaunch' },
  't2f-edge-production': { workerEnv: 'production' },
});
const MAIN_WORKERS = ['t2f-edge-prelaunch', 't2f-edge-production'];
const RE_CONFLICT = /\b100117\b|(custom domain|hostname)[^\n]*(already|exist|conflict|in use)|already[^\n]*(custom domain|hostname)/i;

/**
 * @typedef {{ kind: 'move-domain', at: string, name: string, from: string | null, to: string, gapSeconds: number, createdBinding: string | null }} MoveRecord
 * @typedef {import('./cloudflareApi.mjs').CloudflareApi} CfApi
 * @typedef {import('../ops.mjs').OpsContext} OpsContext
 */

/** @param {string} s */
const norm = (s) => s.trim().toLowerCase().replace(/\.$/, '');
/** @param {string} name */
const isMain = (name) => MAIN_HOSTS.includes(norm(name));

/**
 * Записи `move-domain` з `edge.jsonl`; відсутній файл — порожній, пошкоджений рядок пропускається.
 * @param {string} file
 * @returns {MoveRecord[]}
 */
export function readEdgeJournal(file) {
  if (!fs.existsSync(file)) return [];
  /** @type {MoveRecord[]} */
  const out = [];
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    try {
      const r = JSON.parse(line);
      if (r?.kind === 'move-domain' && typeof r.name === 'string' && typeof r.to === 'string') out.push(r);
    } catch {
      /* пошкоджений рядок пропускається */
    }
  }
  return out;
}

/**
 * Прив’язки імені (`GET /workers/domains?hostname=`); `null` — запит не вдався.
 * @param {CfApi} api
 * @param {string} name
 * @returns {Promise<{ id: string, service?: string }[] | null>}
 */
export async function lookupBindings(api, name) {
  try {
    const r = await api.get(`/workers/domains?hostname=${encodeURIComponent(name)}`);
    if (!r.ok || !Array.isArray(r.body?.result)) return null;
    return r.body.result
      .filter((/** @type {any} */ d) => d && typeof d.id === 'string' && norm(String(d.hostname ?? name)) === norm(name))
      .map((/** @type {any} */ d) => ({ id: d.id, service: typeof d.service === 'string' ? d.service : undefined }));
  } catch {
    return null;
  }
}

/**
 * AC-34: від’єднує прив’язку імені, лише якщо журнал записав її як створену цією командою; робочі хости — ніколи.
 * @param {{ name: string, records: MoveRecord[], api: CfApi }} o
 * @returns {Promise<{ code: 0 } | { code: 2, message: string }>}
 */
export async function detach(o) {
  if (isMain(o.name)) return { code: 2, message: `${o.name}: робочий хост — від’єднання заборонене за жодних прапорців` };
  if (norm(o.name) !== REHEARSAL_NAME) return { code: 2, message: `${o.name}: від’єднання дозволене лише для імені репетиції` };
  const created = new Set(o.records.filter((r) => norm(r.name) === norm(o.name) && r.createdBinding).map((r) => r.createdBinding));
  if (created.size === 0) return { code: 2, message: `${o.name}: журнал не записує прив’язку як створену ops — не від’єдную` };
  const bindings = await lookupBindings(o.api, o.name);
  const mine = bindings?.find((b) => created.has(b.id));
  if (!mine) return { code: 2, message: `${o.name}: прив’язки з журналу в Cloudflare немає — не від’єдную` };
  const r = await o.api.delete(`/workers/domains/${encodeURIComponent(mine.id)}`);
  return r.ok ? { code: 0 } : { code: 2, message: `${o.name}: Cloudflare відмовив у від’єднанні (HTTP ${r.status})` };
}

function readWranglerJson() {
  return JSON.parse(fs.readFileSync(path.join(EDGE_DIR, 'wrangler.json'), 'utf8'));
}

/**
 * Згенерований конфіг двійника (AC-33): `name`, `main`, дата сумісності, без workers.dev і preview, одна прив’язка.
 * @param {string} name ім’я для прив’язки
 * @param {string} [compatibilityDate]
 */
export function twinConfig(name, compatibilityDate = String(readWranglerJson().compatibility_date)) {
  return {
    name: TWIN_WORKER,
    main: TWIN_MAIN,
    compatibility_date: compatibilityDate,
    workers_dev: false,
    preview_urls: false,
    routes: [{ pattern: name, custom_domain: true }],
  };
}

/** Хости з маршрутів Worker’а середовища. @param {string} workerEnv @returns {string[]} */
function envHosts(workerEnv) {
  return (readWranglerJson()?.env?.[workerEnv]?.routes ?? []).map((/** @type {{ pattern: string }} */ r) => norm(r.pattern));
}

/**
 * `ops move-domain`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runMoveDomain(ctx) {
  const { out, err } = ctx;
  const name = norm(String(ctx.args.values.name));
  const to = String(ctx.args.values.to);
  const confirm = ctx.args.values.confirm;
  const doubleFlag = confirm !== undefined && ENVS[confirm]?.mainDomain === true && ctx.args.flags['allow-main-domain'] === true;

  const target = Object.hasOwn(WORKERS, to) ? WORKERS[to] : undefined;
  if (!target) return fail(err, `--to: невідомий Worker ${to}`);
  if (name !== REHEARSAL_NAME && !isMain(name)) {
    return fail(err, `--name: дозволене лише ${REHEARSAL_NAME} (і робочі хости з --confirm <env> --allow-main-domain)`);
  }
  if ((isMain(name) || MAIN_WORKERS.includes(to)) && !doubleFlag) {
    return fail(err, 'робочий домен чи його Worker: потрібні разом --confirm <prelaunch|production> і --allow-main-domain');
  }
  // Двійник — лише для імені репетиції: робочого імені він не отримує за жодних прапорців.
  if (!target.workerEnv && name !== REHEARSAL_NAME) return fail(err, `${to}: двійник обслуговує лише ${REHEARSAL_NAME}`);
  // Робочий Worker — лише з підтвердженням саме його середовища (`--confirm prelaunch` не відкриває production).
  if (MAIN_WORKERS.includes(to) && confirm !== target.workerEnv) {
    return fail(err, `${to}: потрібне --confirm ${target.workerEnv} (підтвердження іншого середовища не діє)`);
  }
  if (target.workerEnv && !envHosts(target.workerEnv).includes(name)) return fail(err, `${to} не обслуговує ім’я ${name}`);

  const explicitTake = ctx.args.values['take-domain-from'];
  if (explicitTake !== undefined && !MAIN_WORKERS.includes(to)) return fail(err, '--take-domain-from: лише для Worker’а робочого домену');

  const api = cloudflareApiFrom(ctx);
  if (!api) return fail(err, 'бракує змінних: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (середовище або --secrets-file)', 1);

  const doFetch = ctx.deps.fetch;
  const clock = ctx.deps.clock;
  const start = ctx.deps.startProbe;
  const envKey = name === REHEARSAL_NAME ? 'rehearsal' : String(confirm);
  const journalFile = path.join(ctx.paths.stateRoot, envKey, EDGE_JOURNAL);
  const records = readEdgeJournal(journalFile);
  const lastTo = [...records].reverse().find((r) => norm(r.name) === name)?.to ?? null;
  const from = lastTo ?? (name === REHEARSAL_NAME ? 't2f-edge-rehearsal' : null);

  if (target.workerEnv && MAIN_WORKERS.includes(to)) {
    // `wrangler deploy --env <prelaunch|production>` ставить усі імена маршрутів середовища з override: спершу — хто
    // їх тримає. Перенесення Worker → Worker: тримач, записаний журналом як `from`, дозволений; інший — лише явно.
    const journalTake = from !== null && norm(from) !== norm(to) ? from : undefined;
    const hosts = envHosts(target.workerEnv);
    let held = await checkDomainHolders({ api, hosts, worker: to, takeFrom: explicitTake ?? journalTake });
    if (!held.ok && explicitTake === undefined && journalTake !== undefined) {
      // Журнальний `from` уже нічого не тримає (імена вільні чи вже в `to`) — це не причина відмовляти.
      const free = await checkDomainHolders({ api, hosts, worker: to });
      if (free.ok) held = free;
    }
    if (!held.ok) return fail(err, held.message);
    if (held.taken.length) out(`move-domain: ім’я забирається в ${held.taken.join(', ')}`);
  }

  /** @type {Set<string>} */
  const answered = new Set();
  const check = async () => {
    const res = await doFetch(`https://${name}/`, { method: 'GET', redirect: 'manual', cache: 'no-store' });
    const ok = res.status === 200;
    if (ok) answered.add(res.headers.get('x-t2f-twin') ? 'twin' : 'main');
    await res.body?.cancel().catch(() => {});
    return ok;
  };

  /** @type {string | null} */
  let tmpDir = null;
  /** @returns {Promise<{ code: number, output: string }>} */
  const deploy = async () => {
    /** @type {string[]} */
    let args;
    /** @type {string} */
    let cwd;
    if (target.workerEnv) {
      args = [WRANGLER_JS, 'deploy', '--env', target.workerEnv];
      cwd = EDGE_DIR;
    } else {
      tmpDir ??= fs.mkdtempSync(path.join(os.tmpdir(), 't2f-twin-'));
      const file = path.join(tmpDir, 'wrangler.json');
      fs.writeFileSync(file, JSON.stringify(twinConfig(name), null, 2));
      args = [WRANGLER_JS, 'deploy', '--config', file];
      cwd = tmpDir;
    }
    const r = await ctx.exec.run(process.execPath, args, {
      cwd,
      env: { ...ctx.env },
      timeoutMs: DEPLOY_TIMEOUT_MS,
      onLine: (_s, line) => out(`  ${line}`),
    });
    return { code: r.code, output: `${r.stdout}\n${r.stderr}` };
  };

  const before = await lookupBindings(api, name);
  const probe = start({ check });
  try {
    await clock.sleep(PROBE_BEFORE_MS);
    out(`move-domain: ${name} → ${to}`);
    let d = await deploy();
    if (d.code !== 0 && RE_CONFLICT.test(d.output)) {
      out('move-domain: конфлікт Custom Domain — пробую від’єднати власну прив’язку (AC-34)');
      const det = await detach({ name, records, api });
      if (det.code !== 0) {
        probe.stop();
        return fail(err, det.message);
      }
      d = await deploy();
    }
    if (d.code !== 0) {
      probe.stop();
      return fail(err, `wrangler deploy завершився з кодом ${d.code}`, 1);
    }
    await clock.sleep(PROBE_AFTER_MS);
  } catch (e) {
    probe.stop();
    return fail(err, messageOf(e), 1);
  } finally {
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
  }
  const result = probe.stop();

  const after = await lookupBindings(api, name);
  const createdBinding = before !== null && before.length === 0 ? (after?.[0]?.id ?? null) : null;
  /** @type {MoveRecord} */
  const record = { kind: 'move-domain', at: ctx.now().toISOString(), name, from, to, gapSeconds: result.downtimeSeconds, createdBinding };
  const json = JSON.stringify(record);
  if (ctx.redactor.contains(json)) return fail(err, 'запис журналу містить зареєстроване секретне значення', 1);
  fs.mkdirSync(path.dirname(journalFile), { recursive: true });
  fs.appendFileSync(journalFile, `${json}\n`, { encoding: 'utf8', mode: 0o600 });
  out(`move-domain: готово; проміжок ${result.downtimeSeconds} с; відповідали: ${[...answered].sort().join(', ') || 'ніхто'}`);
  return 0;
}

/** @param {(l: string) => void} err @param {string} message @param {number} [code] */
function fail(err, message, code = 2) {
  err(`move-domain: ${message}`);
  return code;
}
