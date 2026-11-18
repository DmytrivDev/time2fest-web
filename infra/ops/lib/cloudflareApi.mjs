// @ts-check
// Малий клієнт Cloudflare API: `GET` і `DELETE` за шляхом `/accounts/<id>/…` і `GET` за шляхом `/zones/<id>/…`
// (зона — необов’язкова). Токен і ідентифікатори — лише з середовища ops (`CLOUDFLARE_API_TOKEN`,
// `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_ZONE_ID`), мережа — порт `fetch` контексту. Тіло відповіді віддається
// викликачеві; токен ніде не друкується.

export const CF_API = 'https://api.cloudflare.com/client/v4';
export const CF_ENV = /** @type {const} */ ({ token: 'CLOUDFLARE_API_TOKEN', account: 'CLOUDFLARE_ACCOUNT_ID', zone: 'CLOUDFLARE_ZONE_ID' });

/**
 * @typedef {{ ok: boolean, status: number, body: any }} CfResponse `ok` — HTTP 2xx і `success` не `false`.
 * @typedef {{
 *   account: string,
 *   zone: string | null,
 *   get(pathAndQuery: string): Promise<CfResponse>,
 *   delete(pathAndQuery: string): Promise<CfResponse>,
 *   getZone(pathAndQuery: string): Promise<CfResponse>,
 * }} CloudflareApi `pathAndQuery` — після `/accounts/<id>` (`get`, `delete`), напр. `/workers/domains?hostname=…`,
 *   або після `/zones/<id>` (`getZone`), напр. `/dns_records?name=…`. `getZone` без зони — помилка.
 */

/**
 * @param {{ fetch: typeof globalThis.fetch, account: string, token: string, zone?: string | null }} o
 * @returns {CloudflareApi}
 */
export function createCloudflareApi(o) {
  /** @param {string} method @param {string} url @returns {Promise<CfResponse>} */
  const call = async (method, url) => {
    const res = await o.fetch(url, {
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
  const accountUrl = (/** @type {string} */ p) => `${CF_API}/accounts/${encodeURIComponent(o.account)}${p}`;
  const zone = o.zone || null;
  return {
    account: o.account,
    zone,
    get: (pathAndQuery) => call('GET', accountUrl(pathAndQuery)),
    delete: (pathAndQuery) => call('DELETE', accountUrl(pathAndQuery)),
    getZone: async (pathAndQuery) => {
      if (!zone) throw new Error(`${CF_ENV.zone} не задано`);
      return call('GET', `${CF_API}/zones/${encodeURIComponent(zone)}${pathAndQuery}`);
    },
  };
}

/**
 * Клієнт з облікових даних контексту ops; `null` — бракує токена чи акаунта (назви — `CF_ENV`). Зона — необов’язкова.
 * @param {{ env: Record<string, string | undefined>, deps: { fetch: typeof globalThis.fetch } }} ctx
 * @returns {CloudflareApi | null}
 */
export function cloudflareApiFrom(ctx) {
  const token = ctx.env[CF_ENV.token];
  const account = ctx.env[CF_ENV.account];
  if (!token || !account) return null;
  return createCloudflareApi({ fetch: ctx.deps.fetch, account, token, zone: ctx.env[CF_ENV.zone] ?? null });
}
