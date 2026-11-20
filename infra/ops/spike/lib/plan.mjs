// @ts-check
// Чисті розрахунки спайку: план вузлів із цінами провайдера і звіркою з планом §6, межа життя й вартості, поділ
// з’єднань між генераторами. Жодних викликів мережі.
import { COST_CEILING, EXPECTED_HOURS, LIFETIME_HOURS, NODES, PLAN_PRICES, PRICE_TOLERANCE, ROLE_TAGS } from './config.mjs';

/**
 * @typedef {import('../../lib/capacity/provider.mjs').Size} Size
 * @typedef {import('../../lib/capacity/provider.mjs').Node} Node
 * @typedef {{ role: 'realtime' | 'loadgen', name: string, size: string, region: string, priceHourly: number, planPrice: number, hours: number }} PlanRow
 */

/** @param {number} v */
export const usd = (v) => `$${v.toFixed(3)}`;

/**
 * План: вузол realtime і `generators` генераторів; ціни — з API провайдера. Відмова, якщо розміру немає або ціна вища
 * за план §6 більш ніж на 10%, або очікувана вартість вузлів понад стелю.
 * @param {Size[]} sizes
 * @param {{ generators?: number }} [o]
 * @returns {{ rows: PlanRow[], perHour: number, expected: number, refusals: string[] }}
 */
export function buildPlan(sizes, o = {}) {
  const n = o.generators ?? NODES.loadgen.regions.length;
  /** @type {PlanRow[]} */
  const rows = [];
  /** @type {string[]} */
  const refusals = [];
  /** @param {'realtime' | 'loadgen'} role @param {string} name @param {string} size @param {string} region */
  const add = (role, name, size, region) => {
    const s = sizes.find((x) => x.slug === size);
    const planPrice = PLAN_PRICES[size] ?? 0;
    if (!s) refusals.push(`розміру ${size} немає в API провайдера`);
    const priceHourly = s?.priceHourly ?? 0;
    if (s && planPrice > 0 && priceHourly > planPrice * (1 + PRICE_TOLERANCE)) {
      refusals.push(`${size}: ${usd(priceHourly)}/год у API — понад план ${usd(planPrice)}/год більш ніж на ${PRICE_TOLERANCE * 100}%`);
    }
    if (planPrice === 0) refusals.push(`${size}: немає ціни в плані §6`);
    rows.push({ role, name, size, region, priceHourly, planPrice, hours: EXPECTED_HOURS[role] });
  };
  add('realtime', NODES.realtime.name, NODES.realtime.size, NODES.realtime.region);
  for (let i = 0; i < n; i++) {
    const regions = NODES.loadgen.regions;
    add('loadgen', `${NODES.loadgen.namePrefix}${i + 1}`, NODES.loadgen.size, regions[i % regions.length] ?? 'fra1');
  }
  const perHour = rows.reduce((a, r) => a + r.priceHourly, 0);
  const expected = rows.reduce((a, r) => a + r.priceHourly * r.hours, 0);
  const ceilingNodes = perHour * LIFETIME_HOURS;
  if (ceilingNodes > COST_CEILING) refusals.push(`вузли за ${LIFETIME_HOURS} год коштували б ${usd(ceilingNodes)} — понад стелю $${COST_CEILING}`);
  return { rows, perHour, expected, refusals };
}

/** Теги вузла за роллю. @param {'realtime' | 'loadgen'} role */
export const roleTag = (role) => ROLE_TAGS[role];

/**
 * Вік, вартість і запас до межі життя вузлів спайку. Без `createdAt` вік невідомий — вважається, що межу вичерпано
 * (безпечна сторона).
 * @param {Node[]} nodes
 * @param {Size[]} sizes
 * @param {number} nowMs
 * @returns {{ rows: { node: Node, ageHours: number | null, priceHourly: number, cost: number }[], costSoFar: number, perHour: number, maxAgeHours: number | null, hoursLeft: number }}
 */
export function lifetime(nodes, sizes, nowMs) {
  const rows = nodes.map((node) => {
    const created = node.createdAt ? Date.parse(node.createdAt) : NaN;
    const ageHours = Number.isFinite(created) ? Math.max(0, (nowMs - created) / 3_600_000) : null;
    const priceHourly = sizes.find((s) => s.slug === node.size)?.priceHourly ?? 0;
    return { node, ageHours, priceHourly, cost: ageHours === null ? priceHourly * LIFETIME_HOURS : priceHourly * ageHours };
  });
  const unknown = rows.some((r) => r.ageHours === null);
  const maxAgeHours = unknown ? null : rows.reduce((a, r) => Math.max(a, /** @type {number} */ (r.ageHours)), 0);
  return {
    rows,
    costSoFar: rows.reduce((a, r) => a + r.cost, 0),
    perHour: rows.reduce((a, r) => a + r.priceHourly, 0),
    maxAgeHours,
    hoursLeft: maxAgeHours === null ? 0 : Math.max(0, LIFETIME_HOURS - maxAgeHours),
  };
}

/**
 * Чи можна запускати прогін тривалістю `runSec`: вузли не старші за 6 год (і не стануть до кінця прогону), прогнозована
 * вартість вузлів до кінця прогону ≤ $8.
 * @param {ReturnType<typeof lifetime>} lt
 * @param {number} runSec
 * @returns {string[]} причини відмови (порожньо — можна)
 */
export function runGuard(lt, runSec) {
  /** @type {string[]} */
  const reasons = [];
  if (lt.maxAgeHours === null) reasons.push('вік вузлів невідомий (провайдер не віддав час створення) — межу 6 год не перевірити');
  else if (lt.maxAgeHours + runSec / 3600 > LIFETIME_HOURS) {
    reasons.push(`вузлам ${lt.maxAgeHours.toFixed(2)} год, з прогоном буде понад ${LIFETIME_HOURS} год`);
  }
  const projected = lt.costSoFar + lt.perHour * (runSec / 3600);
  if (projected > COST_CEILING) reasons.push(`прогнозована вартість вузлів ${usd(projected)} — понад стелю $${COST_CEILING}`);
  return reasons;
}

/**
 * Поділ `total` з’єднань між `n` генераторами: рівно, залишок — першим.
 * @param {number} total
 * @param {number} n
 * @returns {number[]}
 */
export function splitConnections(total, n) {
  if (!Number.isInteger(total) || total < 0) throw new Error('кількість з’єднань — ціле ≥ 0');
  if (!Number.isInteger(n) || n < 1) throw new Error('генераторів має бути ≥ 1');
  const base = Math.floor(total / n);
  const rest = total % n;
  return Array.from({ length: n }, (_, i) => base + (i < rest ? 1 : 0));
}
