// @ts-check
// План команди `capacity`: розбір вузлів за тегами, кроки дії від спостереженого стану, рядки плану з ціною.
// Чистий модуль: без вводу-виводу, без провайдера (лише його типи) — його ділять вхід, виконавець і підготовка.
import { BOOTSTRAP_ENVS, ENVS } from '../config.mjs';

export const TAG_MANAGED = 't2f-managed';
export const ROLE_MAIN = 't2f-role-main';
export const ROLE_REALTIME = 't2f-role-realtime';
/** @param {string} env */
export const envTag = (env) => `t2f-env-${env}`;
/** Файл профілю realtime у каталозі вузла (шлях у репозиторії — `REALTIME_COMPOSE_PATH` у `config.mjs`). */
export const REALTIME_COMPOSE_FILE = 'compose.realtime.yml';
/** @param {string} env */
export const realtimeDir = (env) => `/srv/t2f/${env}-realtime`;
/** @param {string} env */
export const realtimeName = (env) => `t2f-${env}-realtime`;

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('./provider.mjs').Size} Size
 * @typedef {import('./provider.mjs').EnvSizes} EnvSizes
 * @typedef {(
 *   | { kind: 'resize', node: Node, from: string, to: string, keepDisk: boolean, price: number, verb: 'збільшити' | 'зменшити' | 'увімкнути' }
 *   | { kind: 'create', name: string, size: string, region: string, tags: string[], price: number }
 *   | { kind: 'prepare', name: string, nodeId: string | null }
 *   | { kind: 'delete', node: Node }
 * )} Step `keepDisk` — зміна розміру лише CPU/RAM; адаптер провайдера гарантує це або відмовляє (AC-48).
 * @typedef {{ main: Node[], realtime: Node[], other: Node[], suspects: Node[] }} Observed
 */

/** @param {number} p */
export const price = (p) => `$${p}/год`;

/**
 * Що зачіпає зміна розміру — з кроку плану (а він — з опції порту `keepDisk`).
 * @param {boolean} keepDisk
 */
export const resizeScope = (keepDisk) => (keepDisk ? 'лише CPU і RAM, диск без змін' : 'CPU, RAM і диск');

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
 * Кроки дії від спостереженого стану (AC-47 … AC-52). Чиста: нічого не читає й не змінює; відмова — до будь-якої зміни.
 * @param {{
 *   env: string,
 *   action: string,
 *   sizeArg: string | undefined,
 *   envSizes: EnvSizes,
 *   seen: Observed,
 *   sizes: Size[],
 *   isPrepared: (nodeId: string) => boolean,
 * }} o `isPrepared` — чи журнал записав успішну підготовку вузла realtime
 * @returns {{ code: 0, steps: Step[] } | { code: 2, message: string }}
 */
export function planSteps(o) {
  const { env, action, sizeArg, envSizes, seen } = o;
  /** @param {string} slug */
  const sizeOf = (slug) => o.sizes.find((s) => s.slug === slug);
  /** @param {string} message @returns {{ code: 2, message: string }} */
  const no = (message) => ({ code: 2, message });

  // AC-47: ресурс з роллю, яку зачіпає дія, але без обох тегів — відмова з його назвою, до будь-якої зміни.
  const touchesMain = ['night', 'back', 'off-season'].includes(action);
  const touchesRealtime = ['off-season', 'realtime-create', 'realtime-delete'].includes(action);
  const blocked = seen.suspects.filter(
    (n) =>
      (touchesMain && n.tags.includes(ROLE_MAIN)) ||
      (touchesRealtime && (n.tags.includes(ROLE_REALTIME) || n.name === realtimeName(env))),
  );
  if (blocked.length) {
    return no(`відмова: ${blocked.map((n) => n.name).join(', ')} — немає обох тегів ${TAG_MANAGED} і ${envTag(env)}; змінювати чи видаляти не буду`);
  }

  /** @type {Step[]} */
  const steps = [];
  if (touchesMain) {
    const target = action === 'night' ? /** @type {string} */ (sizeArg) : envSizes.main.offSeason;
    if (!envSizes.main.allowed.includes(target)) {
      return no(`розмір ${target} не в переліку дозволених для ${env}: ${envSizes.main.allowed.join(', ')}`);
    }
    const to = sizeOf(target);
    if (!to) return no(`розмір ${target} недоступний у провайдера`);
    if (seen.main.length !== 1) {
      // AC-50: другого екземпляра сервера немає й не створюється; основний вузол не створюється командою.
      return no(seen.main.length ? `основних вузлів ${seen.main.length} (${seen.main.map((n) => n.name).join(', ')}): очікується один` : `основного вузла ${env} немає (теги ${TAG_MANAGED}, ${envTag(env)}, ${ROLE_MAIN})`);
    }
    const main = /** @type {Node} */ (seen.main[0]);
    if (main.size !== target || main.status !== 'active') {
      const from = sizeOf(main.size);
      const bigger = !from || to.vcpus > from.vcpus || to.memoryMb > from.memoryMb;
      const verb = main.size === target ? 'увімкнути' : bigger ? 'збільшити' : 'зменшити';
      steps.push({ kind: 'resize', node: main, from: main.size, to: target, keepDisk: true, price: to.priceHourly, verb });
    }
  }
  if (action === 'realtime-create') {
    if (ENVS[env]?.bootstrap !== true) return no(`realtime-create: підготовка вузла (bootstrap) зараз лише для ${BOOTSTRAP_ENVS.join(', ')}`);
    if (seen.realtime.length > 1) return no(`вузлів realtime ${seen.realtime.length}: очікується не більше одного`);
    const existing = seen.realtime[0];
    if (!existing) {
      const size = sizeOf(envSizes.realtime.size);
      if (!size) return no(`розмір ${envSizes.realtime.size} недоступний у провайдера`);
      const tags = [TAG_MANAGED, envTag(env), ROLE_REALTIME];
      steps.push({ kind: 'create', name: realtimeName(env), size: size.slug, region: envSizes.region, tags, price: size.priceHourly });
      steps.push({ kind: 'prepare', name: realtimeName(env), nodeId: null });
    } else {
      if (!o.isPrepared(existing.id)) steps.push({ kind: 'prepare', name: existing.name, nodeId: existing.id });
    }
  }
  if (action === 'realtime-delete' || action === 'off-season') {
    for (const n of seen.realtime) steps.push({ kind: 'delete', node: n });
  }

  return { code: 0, steps };
}

/**
 * Рядок кроку для плану й звіту. Ціна — для кожного кроку, що створює ресурс чи міняє його розмір (NFR-5).
 * @param {Step} s
 * @param {string} env
 */
export function label(s, env) {
  switch (s.kind) {
    case 'resize':
      return `${s.verb} ${s.node.name}: ${s.from} → ${s.to} (${resizeScope(s.keepDisk)}) — ${price(s.price)}`;
    case 'create':
      return `створити ${s.name} (${s.size}, ${s.region}, теги ${s.tags.join(' ')}) — ${price(s.price)}`;
    case 'prepare':
      return `підготувати ${s.name}: bootstrap і ${REALTIME_COMPOSE_FILE} у ${realtimeDir(env)} (не запускається)`;
    case 'delete':
      return `видалити ${s.node.name} (${s.node.size}) — видалення, не вимкнення`;
  }
}
