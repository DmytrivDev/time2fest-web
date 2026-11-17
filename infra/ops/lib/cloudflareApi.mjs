// @ts-check
// Малий клієнт Cloudflare API в межах акаунта: `GET` і `DELETE` за шляхом `/accounts/<id>/…`.
// Токен і ідентифікатор акаунта — лише з середовища ops (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`),
// мережа — порт `fetch` контексту. Тіло відповіді віддається викликачеві; токен ніде не друкується.

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const CF_ENV = /** @type {const} */ ({ token: 'CLOUDFLARE_API_TOKEN', account: 'CLOUDFLARE_ACCOUNT_ID' });

/**
 * @typedef {{ ok: boolean, status: number, body: any }} CfResponse `ok` — HTTP 2xx і `success` не `false`.
 * @typedef {{
 *   account: string,
 *   get(pathAndQuery: string): Promise<CfResponse>,
 *   delete(pathAndQuery: string): Promise<CfResponse>,
 * }} CloudflareApi `pathAndQuery` — після `/accounts/<id>`, напр. `/workers/domains?hostname=…`.
 */

/**
 * @param {{ fetch: typeof globalThis.fetch, account: string, token: string }} o
 * @returns {CloudflareApi}
 */
export function createCloudflareApi(o) {
  /** @param {string} method @param {string} pathAndQuery @returns {Promise<CfResponse>} */
  const call = async (method, pathAndQuery) => {
    const res = await o.fetch(`${CF_API}/accounts/${encodeURIComponent(o.account)}${pathAndQuery}`, {
      method,
      headers: { Authorization: `Bearer ${o.token}`, Accept: 'application/json' },
    });
    /** @type {any} */
    let body = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    return { ok: res.ok && body?.success !== false, status: res.status, body };
  };
  return {
    account: o.account,
    get: (pathAndQuery) => call('GET', pathAndQuery),
    delete: (pathAndQuery) => call('DELETE', pathAndQuery),
  };
}

/**
 * Клієнт з облікових даних контексту ops; `null` — бракує токена чи акаунта (назви — `CF_ENV`).
 * @param {{ env: Record<string, string | undefined>, deps: { fetch: typeof globalThis.fetch } }} ctx
 * @returns {CloudflareApi | null}
 */
export function cloudflareApiFrom(ctx) {
  const token = ctx.env[CF_ENV.token];
  const account = ctx.env[CF_ENV.account];
  if (!token || !account) return null;
  return createCloudflareApi({ fetch: ctx.deps.fetch, account, token });
}
