// @ts-check
// Інтерфейс провайдера потужності (AC-45): команда `capacity` звертається до провайдера лише через нього.
// Дві реалізації — фейк (`fake.mjs`) і адаптер провайдера в його власній теці; обидві проходять один контрактний
// набір (`test/capacity/provider.contract.mjs`). Назви й поля конкретного провайдера тут не трапляються.

/**
 * @typedef {'active' | 'off' | 'new'} NodeStatus
 * @typedef {{
 *   id: string,
 *   name: string,
 *   size: string,
 *   status: NodeStatus,
 *   tags: string[],
 *   publicIp: string | null,
 *   diskGb: number,
 * }} Node `diskGb` — щоб контракт бачив: зміна розміру не чіпає диска (AC-48).
 * @typedef {{ slug: string, vcpus: number, memoryMb: number, diskGb: number, priceHourly: number }} Size
 * @typedef {{ name: string, region: string, size: string, tags: string[] }} NodeSpec
 * @typedef {{ keepDisk: boolean, requireTags: string[] }} ResizeOpts `keepDisk: true` — лише CPU/RAM, диск не змінюється
 *   (зміну можна повернути); `requireTags` — теги, які вузол мусить мати в момент дії (див. `assertNodeTags`).
 * @typedef {{ requireTags: string[] }} DeleteOpts
 * @typedef {{ keepDisk: boolean }} ResizeResult Що адаптер справді зробив з диском.
 * @typedef {{
 *   listNodes(tags: string[]): Promise<Node[]>,
 *   sizes(): Promise<Size[]>,
 *   createNode(spec: NodeSpec): Promise<Node>,
 *   resizeNode(id: string, size: string, opts: ResizeOpts): Promise<ResizeResult>,
 *   deleteNode(id: string, opts: DeleteOpts): Promise<void>,
 *   waitNode(id: string, state: NodeStatus): Promise<Node>,
 * }} Provider
 * `listNodes` — лише вузли з усіма тегами; `createNode` повертає вже активний вузол; `resizeNode` виконує те, що
 * просить `opts`, або відмовляє до будь-якої зміни (адаптер, що не вміє зберегти диск, — відмова на `keepDisk: true`);
 * вузол після неї знову активний (повторний виклик на вимкненому вузлі того ж розміру лише вмикає його).
 * `resizeNode` і `deleteNode` самі перечитують вузол і відмовляють до будь-якої зміни, якщо в нього немає всіх
 * `requireTags` (порожній перелік — теж відмова): тегова межа діє й там, де викликач помилився з id.
 * @typedef {{
 *   region: string,
 *   main: { offSeason: string, allowed: string[] },
 *   realtime: { size: string },
 * }} EnvSizes Розміри середовища: залежать від провайдера, тому живуть у його конфігурації.
 * @typedef {{ name: string, provider: Provider, envSizes: Record<string, EnvSizes> }} ProviderBundle
 */

/**
 * Тегова межа перед зміною чи видаленням: вузол мусить мати всі `requireTags`; порожній перелік — відмова.
 * @param {Node} node
 * @param {string[] | undefined} requireTags
 * @param {string} step
 */
export function assertNodeTags(node, requireTags, step) {
  if (!Array.isArray(requireTags) || requireTags.length === 0) throw new Error(`${step}: не задано обов’язкових тегів — відмова`);
  const missing = requireTags.filter((t) => !node.tags.includes(t));
  if (missing.length) throw new Error(`${step}: вузол ${node.name} не має тегів ${missing.join(', ')} — не змінюється`);
}

/** Помилка API провайдера: статус HTTP (0 — мережа), пауза до повтору, назва виклику. Тіло відповіді не несе. */
export class ProviderError extends Error {
  /** @param {{ status: number, retryAfterSec?: number, step: string }} o */
  constructor({ status, retryAfterSec, step }) {
    const retry = retryAfterSec !== undefined ? `; повтор не раніше ніж за ${retryAfterSec} с` : '';
    super(`провайдер: ${step} → ${status === 0 ? 'мережа недоступна' : `HTTP ${status}`}${retry}`);
    this.name = 'ProviderError';
    this.status = status;
    this.retryAfterSec = retryAfterSec;
    this.step = step;
  }
}
