// @ts-check

const DEFAULT_BASE = 'https://api.cloudflare.com/client/v4';
/** Розмір сторінки й межа сторінок для списків (`getAll`). */
const PER_PAGE = 50;
const MAX_PAGES = 100;
const LOCAL_BASE = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/;

export class ApiRefusal extends Error {
  /**
   * @param {{ status: number, category: string, method: string, path: string }} info
   */
  constructor({ status, category, method, path }) {
    super(`Cloudflare API відмовив: ${method} ${path} → ${status} (${category})`);
    this.name = 'ApiRefusal';
    this.status = status;
    this.category = category;
    this.method = method;
    this.path = path;
  }
}

/**
 * Базова адреса: лише справжній API, або loopback у тестах.
 * @param {Record<string, string | undefined>} env
 */
export function resolveBase(env) {
  const custom = env.CLOUDFLARE_API_BASE;
  if (!custom) return DEFAULT_BASE;
  if (!LOCAL_BASE.test(custom)) {
    throw new Error('CLOUDFLARE_API_BASE дозволено лише як http://127.0.0.1:<port> або http://localhost:<port>');
  }
  return `${custom}/client/v4`;
}

/**
 * @param {{ env: Record<string, string | undefined>, fetch?: typeof globalThis.fetch }} deps
 */
export function createApi({ env, fetch = globalThis.fetch }) {
  const base = resolveBase(env);
  const token = env.CLOUDFLARE_API_TOKEN_INFRA;
  /**
   * @param {string} method
   * @param {string} category tunnel | dns | waf | config-rules | zone-settings | bot-management | access
   * @param {string} path шлях після /client/v4
   * @param {unknown} [body]
   * @returns {Promise<any>} уся відповідь (`result`, `result_info`)
   */
  async function call(method, category, path, body) {
    const shown = path.split('?')[0] ?? path;
    const res = await fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    // Тіло відповіді при відмові ніколи не друкується.
    if (!res.ok) throw new ApiRefusal({ status: res.status, category, method, path: shown });
    /** @type {any} */
    const json = await res.json();
    if (json && json.success === false) throw new ApiRefusal({ status: res.status, category, method, path: shown });
    return json;
  }
  /** @param {string} method @param {string} category @param {string} path @param {unknown} [body] @returns {Promise<any>} поле `result` */
  const request = async (method, category, path, body) => (await call(method, category, path, body))?.result;
  return {
    request,
    /** @param {string} category @param {string} path */
    get: (category, path) => request('GET', category, path),
    /**
     * Увесь список з усіх сторінок (`page`, `per_page`, `result_info.total_pages`). Без `result_info` — одна сторінка.
     * @param {string} category @param {string} path без `page`/`per_page`
     * @returns {Promise<any[]>}
     */
    async getAll(category, path) {
      /** @type {any[]} */
      const all = [];
      const sep = path.includes('?') ? '&' : '?';
      for (let page = 1; page <= MAX_PAGES; page++) {
        const json = await call('GET', category, `${path}${sep}page=${page}&per_page=${PER_PAGE}`);
        const list = Array.isArray(json?.result) ? json.result : [];
        all.push(...list);
        const total = Number(json?.result_info?.total_pages);
        if (!Number.isFinite(total) || page >= total || list.length === 0) return all;
      }
      throw new Error(`Cloudflare API: ${path.split('?')[0]} — понад ${MAX_PAGES} сторінок`);
    },
  };
}
