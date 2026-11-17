// @ts-check
// Реєстр провайдерів потужності: єдине місце поза текою адаптера, що називає його (точка підключення, AC-45).
// Провайдер обирається змінною `T2F_PROVIDER`; адаптер завантажується лише коли його обрано.

/** @typedef {(o: { env: Record<string, string | undefined> }) => import('./provider.mjs').ProviderBundle} BundleFactory */

export const DEFAULT_PROVIDER = 'digitalocean';

/** @type {Record<string, () => Promise<BundleFactory>>} */
export const PROVIDERS = {
  digitalocean: async () => (await import('./digitalocean/adapter.mjs')).createBundle,
};

/**
 * Набір провайдера з `T2F_PROVIDER` (за замовчуванням — `DEFAULT_PROVIDER`). Невідома назва чи відсутній токен — виняток.
 * @param {Record<string, string | undefined>} env
 * @returns {Promise<import('./provider.mjs').ProviderBundle>}
 */
export async function loadProvider(env) {
  const name = env.T2F_PROVIDER || DEFAULT_PROVIDER;
  if (!Object.hasOwn(PROVIDERS, name)) throw new Error(`T2F_PROVIDER: невідомий провайдер; дозволено: ${Object.keys(PROVIDERS).join(', ')}`);
  const factory = await PROVIDERS[name]();
  return factory({ env });
}
