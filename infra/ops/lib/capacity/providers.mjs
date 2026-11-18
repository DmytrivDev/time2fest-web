// @ts-check
// Реєстр провайдерів потужності: єдине місце поза текою адаптера, що називає його (точка підключення, AC-45).
// Провайдер обирається змінною `T2F_PROVIDER`; адаптер завантажується лише коли його обрано.

/**
 * @typedef {{ env: Record<string, string | undefined>, fetch: typeof globalThis.fetch, clock: import('../node.mjs').Clock }} BundleInput
 * @typedef {(o: BundleInput) => import('./provider.mjs').ProviderBundle} BundleFactory
 */

export const DEFAULT_PROVIDER = 'digitalocean';

/** @type {Record<string, () => Promise<BundleFactory>>} */
export const PROVIDERS = {
  digitalocean: async () => (await import('./digitalocean/adapter.mjs')).createBundle,
};

/**
 * Набір провайдера з `T2F_PROVIDER` (за замовчуванням — `DEFAULT_PROVIDER`). Невідома назва чи відсутній токен — виняток.
 * Мережа й годинник — порти контексту ops (складаються в `ops.mjs`).
 * @param {BundleInput} o
 * @returns {Promise<import('./provider.mjs').ProviderBundle>}
 */
export async function loadProvider(o) {
  const { env } = o;
  const name = env.T2F_PROVIDER || DEFAULT_PROVIDER;
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`T2F_PROVIDER: невідомий провайдер; дозволено: ${Object.keys(PROVIDERS).join(', ')}`);
  const factory = await PROVIDERS[name]();
  return factory(o);
}
