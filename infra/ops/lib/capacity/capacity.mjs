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
import { messageOf } from '../common.mjs';
import { REALTIME_COMPOSE_PATH } from '../config.mjs';
import { execute, journalFile, readJournal } from './execute.mjs';
import { classify, composeServices, envTag, label, planSteps, price, SERVER2_ACTIONS, TAG_MANAGED } from './plan.mjs';

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('./provider.mjs').Size} Size
 * @typedef {import('./provider.mjs').ProviderBundle} ProviderBundle
 * @typedef {import('./provider.mjs').EnvSizes} EnvSizes
 * @typedef {import('./plan.mjs').Observed} Observed
 * @typedef {import('../../ops.mjs').OpsContext} OpsContext
 */

/**
 * `ops capacity`.
 * @param {OpsContext} ctx
 * @returns {Promise<number>}
 */
export async function runCapacity(ctx) {
  const { out, err } = ctx;
  const env = /** @type {string} */ (ctx.args.env);
  const action = /** @type {string} */ (ctx.args.action);
  const clock = ctx.deps.clock;
  const confirm = ctx.args.values.confirm;
  const sizeArg = ctx.args.values.size;
  /** @param {string} m */
  const refuse = (m) => {
    err(`capacity: ${m}`);
    return 2;
  };

  if (confirm !== undefined && confirm !== env) return refuse(`--confirm ${confirm} не збігається з --env ${env}`);
  if (action === 'night' && sizeArg === undefined) return refuse('night: потрібен --size <розмір>');
  if (action !== 'night' && action !== 'server2-create' && sizeArg !== undefined) return refuse(`--size дозволено лише для night і server2-create`);
  // O·P18a: другий вузол сервера — лише репетиція; відмова до будь-якого звернення до провайдера.
  if (SERVER2_ACTIONS.includes(action) && env !== 'rehearsal') return refuse(`${action}: лише --env rehearsal`);

  /** @type {ProviderBundle} */
  let bundle;
  try {
    bundle = await ctx.deps.provider();
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

  const planned = planSteps({
    env,
    action,
    sizeArg,
    envSizes,
    seen,
    sizes,
    isPrepared: (nodeId) => readJournal(journalFile(ctx.paths, env)).some((r) => r?.step === 'prepare' && r?.result === 'ok' && r?.nodeId === nodeId),
  });
  if (planned.code !== 0) return refuse(planned.message);
  const { steps } = planned;

  /** @type {string | undefined} */
  let composeText;
  if (steps.some((s) => s.kind === 'prepare' && s.role !== 'server2')) {
    const file = ctx.paths.realtimeComposeFile;
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
    if (action === 'server2-delete') return remainingInventory(ctx, bundle, env, envSizes, sizes, suspectLine);
    return 0;
  }
  steps.forEach((s, i) => out(`  ${i + 1}. ${label(s, env)}`));
  if (confirm !== env) {
    out(`capacity: це лише план; щоб виконати — --confirm ${env}`);
    return 0;
  }
  const code = await execute(ctx, { env, action, steps, bundle, clock, composeText: composeText ?? '' });
  // O·P18a: після видалення другого вузла — що лишилося в середовищі.
  if (action === 'server2-delete' && code === 0) return remainingInventory(ctx, bundle, env, envSizes, sizes, suspectLine);
  return code;
}

/**
 * O·P18a: інвентар після `server2-delete` (перечитано з провайдера).
 * @param {OpsContext} ctx
 * @param {ProviderBundle} bundle
 * @param {string} env
 * @param {EnvSizes} envSizes
 * @param {Size[]} sizes
 * @param {(n: Node) => string} suspectLine
 */
async function remainingInventory(ctx, bundle, env, envSizes, sizes, suspectLine) {
  try {
    const seen = classify([await bundle.provider.listNodes([TAG_MANAGED]), await bundle.provider.listNodes([envTag(env)])], env);
    ctx.out('capacity: лишилося:');
    return printInventory(ctx, bundle.name, env, envSizes, seen, sizes, suspectLine);
  } catch (e) {
    ctx.err(`capacity: інвентар після видалення не прочитано: ${messageOf(e)}`);
    return 1;
  }
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
  const row = (n, role) => out(`  ${n.name} — ${role}, ${n.size}, ${n.status}, ${n.publicIp ?? 'без адреси'}${n.privateIp ? `, приватна ${n.privateIp}` : ''}`);
  for (const n of seen.main) row(n, 'основний');
  for (const n of seen.realtime) row(n, 'realtime');
  for (const n of seen.server2) row(n, 'другий сервер (тимчасовий)');
  for (const n of seen.other) row(n, 'без ролі');
  for (const n of seen.suspects) out(`  ${suspectLine(n)}`);
  if (!seen.main.length && !seen.realtime.length && !seen.server2.length && !seen.other.length && !seen.suspects.length) out('  немає');
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
  for (const n of seen.server2) drift.push(`другий сервер (тимчасовий) ${n.name} є (${n.size}, ${price(sizeOf(n.size)?.priceHourly ?? 0)}, приватна ${n.privateIp ?? '—'}), після навчання його немає`);
  for (const n of seen.suspects) drift.push(suspectLine(n));
  out(`capacity ${env} status (поза сезоном: основний ${off}, без вузла realtime):`);
  if (!drift.length) out('  розбіжностей немає');
  for (const d of drift) out(`  ${d}`);
  return 0;
}
