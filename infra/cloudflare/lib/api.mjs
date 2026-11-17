// @ts-check

const DEFAULT_BASE = 'https://api.cloudflare.com/client/v4';
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
   * @param {string} category tunnel | dns | waf | config-rules | zone-settings | bot-management
   * @param {string} path шлях після /client/v4
   * @param {unknown} [body]
   * @returns {Promise<any>} поле `result`
   */
  async function request(method, category, path, body) {
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
    return json?.result;
  }
  return {
    request,
    /** @param {string} category @param {string} path */
    get: (category, path) => request('GET', category, path),
  };
}
