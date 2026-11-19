// @ts-check
// Фейковий провайдер у пам’яті: теги, таблиця розмірів з цінами за годину, сценарні помилки й журнал викликів.
// Для тестів `capacity` і контрактного набору; мережі не торкається.
import { assertNodeTags, ProviderError } from './provider.mjs';

/**
 * @typedef {import('./provider.mjs').Node} Node
 * @typedef {import('./provider.mjs').Size} Size
 * @typedef {import('./provider.mjs').Provider} Provider
 * @typedef {import('./provider.mjs').EnvSizes} EnvSizes
 * @typedef {{ name: string, size: string, tags: string[], status?: Node['status'], diskGb?: number, publicIp?: string | null, privateIp?: string | null, vpcId?: string | null }} SeedNode
 */

/** Ціни за годину — публічні ціни (USD/міс ÷ 672 год), як їх віддає API провайдера. @type {Size[]} */
export const FAKE_SIZES = [
  { slug: 's-1vcpu-2gb', vcpus: 1, memoryMb: 2048, diskGb: 50, priceHourly: 0.01786 },
  { slug: 's-2vcpu-2gb', vcpus: 2, memoryMb: 2048, diskGb: 60, priceHourly: 0.02679 },
  { slug: 's-2vcpu-4gb', vcpus: 2, memoryMb: 4096, diskGb: 80, priceHourly: 0.03571 },
  { slug: 's-4vcpu-8gb', vcpus: 4, memoryMb: 8192, diskGb: 160, priceHourly: 0.07143 },
  { slug: 's-8vcpu-16gb', vcpus: 8, memoryMb: 16384, diskGb: 320, priceHourly: 0.14286 },
  { slug: 'c-4', vcpus: 4, memoryMb: 8192, diskGb: 50, priceHourly: 0.125 },
];

/**
 * Розміри середовищ для тестів на фейку (форма — як у конфігурації адаптера провайдера; самі значення адаптера
 * перевіряє `test/capacity/capacity.test.mjs` на фейку з його `ENV_SIZES`). @type {Record<string, EnvSizes>}
 */
export const FAKE_ENV_SIZES = {
  rehearsal: {
    region: 'fra1',
    main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb'] },
    realtime: { size: 's-2vcpu-4gb' },
    server2: { size: 's-1vcpu-2gb', allowed: ['s-1vcpu-2gb', 's-2vcpu-2gb'] },
  },
  production: {
    region: 'fra1',
    main: { offSeason: 's-2vcpu-4gb', allowed: ['s-2vcpu-4gb', 's-4vcpu-8gb', 's-8vcpu-16gb'] },
    realtime: { size: 'c-4' },
  },
};

export const MUTATING = ['createNode', 'resizeNode', 'deleteNode'];
/** Типова VPC фейка (як типова VPC регіону в провайдера). */
export const FAKE_VPC = 'fake-vpc-fra1';

/**
 * @param {{ nodes?: SeedNode[], sizes?: Size[] }} [o]
 */
export function createFakeProvider(o = {}) {
  const sizes = (o.sizes ?? FAKE_SIZES).map((s) => ({ ...s }));
  let nextId = 1000;
  /** @param {string} slug */
  const diskOf = (slug) => sizes.find((s) => s.slug === slug)?.diskGb ?? 25;
  /** @type {Node[]} */
  const nodes = (o.nodes ?? []).map((n) => ({
    id: String(nextId++),
    name: n.name,
    size: n.size,
    status: n.status ?? 'active',
    tags: [...n.tags],
    publicIp: n.publicIp ?? `203.0.113.${nextId - 1000}`,
    diskGb: n.diskGb ?? diskOf(n.size),
    privateIp: n.privateIp === undefined ? `10.114.0.${nextId - 1000}` : n.privateIp,
    vpcId: n.vpcId === undefined ? FAKE_VPC : n.vpcId,
  }));
  /** @type {{ method: string, args: unknown[], failed?: number }[]} */
  const calls = [];
  /** @type {{ id: string, size: string, disk: false }[]} */
  const resizes = [];
  /** @type {Map<number, { status: number, retryAfterSec?: number }>} */
  const scripted = new Map();

  /**
   * Рахує виклик і кидає сценарну помилку, якщо її призначено на цей номер.
   * @param {string} method
   * @param {unknown[]} args
   */
  const enter = (method, args) => {
    calls.push({ method, args });
    const fail = scripted.get(calls.length);
    if (fail) {
      const rec = /** @type {{ method: string, args: unknown[], failed?: number }} */ (calls[calls.length - 1]);
      rec.failed = fail.status;
      throw new ProviderError({ status: fail.status, retryAfterSec: fail.retryAfterSec, step: method });
    }
  };
  /** @param {string} id @param {string} step */
  const find = (id, step) => {
    const n = nodes.find((x) => x.id === id);
    if (!n) throw new ProviderError({ status: 404, step });
    return n;
  };
  /** @param {Node} n @returns {Node} */
  const copy = (n) => ({ ...n, tags: [...n.tags] });

  /** @type {Provider} */
  const provider = {
    async listNodes(tags) {
      enter('listNodes', [tags]);
      return nodes.filter((n) => tags.every((t) => n.tags.includes(t))).map(copy);
    },
    async sizes() {
      enter('sizes', []);
      return sizes.map((s) => ({ ...s }));
    },
    async createNode(spec) {
      enter('createNode', [spec]);
      if (!sizes.some((s) => s.slug === spec.size)) throw new ProviderError({ status: 422, step: 'createNode' });
      const id = String(nextId++);
      /** @type {Node} */
      const n = { id, name: spec.name, size: spec.size, status: 'active', tags: [...spec.tags], publicIp: `203.0.113.${Number(id) - 1000}`, diskGb: diskOf(spec.size), privateIp: `10.114.0.${Number(id) - 1000}`, vpcId: spec.vpcId ?? FAKE_VPC };
      nodes.push(n);
      return copy(n);
    },
    async resizeNode(id, size, opts) {
      if (opts?.keepDisk !== true) throw new Error('resizeNode: фейк уміє лише keepDisk: true');
      enter('resizeNode', [id, size]);
      const n = find(id, 'resizeNode');
      assertNodeTags(n, opts.requireTags, 'resizeNode');
      if (!sizes.some((s) => s.slug === size)) throw new ProviderError({ status: 422, step: 'resizeNode' });
      resizes.push({ id, size, disk: false });
      n.size = size;
      n.status = 'active';
      return { keepDisk: true };
    },
    async deleteNode(id, opts) {
      enter('deleteNode', [id]);
      assertNodeTags(find(id, 'deleteNode'), opts?.requireTags, 'deleteNode');
      nodes.splice(nodes.findIndex((x) => x.id === id), 1);
    },
    async waitNode(id, state) {
      enter('waitNode', [id, state]);
      const n = find(id, 'waitNode');
      n.status = state;
      return copy(n);
    },
  };

  return {
    provider,
    nodes,
    calls,
    resizes,
    /** Виклики, що змінюють ресурси (включно з тими, що впали). */
    mutating: () => calls.filter((c) => MUTATING.includes(c.method)),
    /**
     * Помилка на n-му виклику (від 1, рахуючи всі методи).
     * @param {number} n @param {number} status @param {number} [retryAfterSec]
     */
    failOnCall(n, status, retryAfterSec) {
      scripted.set(n, { status, retryAfterSec });
    },
    /** Помилка на наступному виклику. @param {number} status @param {number} [retryAfterSec] */
    failNext(status, retryAfterSec) {
      scripted.set(calls.length + 1, { status, retryAfterSec });
    },
  };
}
