// @ts-check
// Фальшивий Cloudflare в пам'яті: fetch(url, init) і loopback HTTP-сервер над тим самим станом.
import { createServer } from 'node:http';

/**
 * @param {{ mutationDelayMs?: number }} [opts]
 */
export function createFakeApi(opts = {}) {
  let seq = 0;
  const nextId = () => `id${String(++seq).padStart(4, '0')}`;
  const state = {
    /** @type {{ id: string, name: string, token: string, ingress: any[] | null }[]} */
    tunnels: [],
    /** @type {any[]} */
    dns: [{ id: nextId(), name: 'time2fest.com', type: 'MX', content: 'mx.example.net', proxied: false }],
    /** @type {Record<string, any[]>} */
    rulesets: {},
    settings: { pseudo_ipv4: 'off' },
    botFightMode: false,
  };
  /** @type {{ method: string, path: string }[]} */
  const log = [];
  /** @type {Record<string, number>} */
  const refusals = {};

  /** @param {string} path */
  const categoryOf = (path) => {
    if (path.includes('cfd_tunnel')) return 'tunnel';
    if (path.includes('dns_records')) return 'dns';
    if (path.includes('/rulesets/phases/http_config_settings')) return 'config-rules';
    if (path.includes('/rulesets/')) return 'waf';
    if (path.includes('bot_management')) return 'bot-management';
    return 'zone-settings';
  };

  /**
   * @param {string} method
   * @param {string} pathname без /client/v4
   * @param {URLSearchParams} query
   * @param {any} body
   * @returns {{ status: number, result?: any }}
   */
  function handle(method, pathname, query, body) {
    log.push({ method, path: pathname });
    const refused = refusals[categoryOf(pathname)];
    if (refused) return { status: refused };
    /** @type {RegExpMatchArray | null | undefined} */
    let m;
    if (method === 'GET' && (m = pathname.match(/^\/accounts\/[^/]+\/cfd_tunnel$/))) {
      const name = query.get('name');
      return { status: 200, result: state.tunnels.filter((t) => !name || t.name === name).map((t) => ({ id: t.id, name: t.name })) };
    }
    if (method === 'GET' && (m = pathname.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/))) {
      const t = state.tunnels.find((x) => x.id === m?.[1]);
      return t ? { status: 200, result: { config: t.ingress ? { ingress: t.ingress } : null } } : { status: 404 };
    }
    if (method === 'GET' && (m = pathname.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/token$/))) {
      const t = state.tunnels.find((x) => x.id === m?.[1]);
      return t ? { status: 200, result: t.token } : { status: 404 };
    }
    if (method === 'POST' && /^\/accounts\/[^/]+\/cfd_tunnel$/.test(pathname)) {
      const t = { id: nextId(), name: body.name, token: `fake-tunnel-token-${seq}`, ingress: null };
      state.tunnels.push(t);
      return { status: 200, result: { id: t.id, name: t.name, token: t.token } };
    }
    if (method === 'PUT' && (m = pathname.match(/^\/accounts\/[^/]+\/cfd_tunnel\/([^/]+)\/configurations$/))) {
      const t = state.tunnels.find((x) => x.id === m?.[1]);
      if (!t) return { status: 404 };
      t.ingress = body.config.ingress;
      return { status: 200, result: { config: body.config } };
    }
    if (method === 'GET' && /^\/zones\/[^/]+\/dns_records$/.test(pathname)) {
      const name = query.get('name');
      return { status: 200, result: state.dns.filter((r) => !name || r.name === name) };
    }
    if ((method === 'POST' || method === 'PATCH') && (m = pathname.match(/^\/zones\/[^/]+\/dns_records(?:\/([^/]+))?$/))) {
      if (method === 'POST') {
        const r = { id: nextId(), ...body };
        state.dns.push(r);
        return { status: 200, result: r };
      }
      const r = state.dns.find((x) => x.id === m?.[1]);
      if (!r) return { status: 404 };
      Object.assign(r, body);
      return { status: 200, result: r };
    }
    if ((m = pathname.match(/^\/zones\/[^/]+\/rulesets\/phases\/([^/]+)\/entrypoint$/))) {
      const phase = String(m[1]);
      if (method === 'GET') {
        const rules = state.rulesets[phase];
        return rules ? { status: 200, result: { rules } } : { status: 404 };
      }
      if (method === 'PUT') {
        state.rulesets[phase] = (body.rules ?? []).map((/** @type {any} */ r) => ({ id: nextId(), ...r }));
        return { status: 200, result: { rules: state.rulesets[phase] } };
      }
    }
    if ((m = pathname.match(/^\/zones\/[^/]+\/settings\/([^/]+)$/))) {
      const key = String(m[1]);
      if (method === 'GET') return { status: 200, result: { id: key, value: /** @type {any} */ (state.settings)[key] ?? null } };
      if (method === 'PATCH') {
        /** @type {any} */ (state.settings)[key] = body.value;
        return { status: 200, result: { id: key, value: body.value } };
      }
    }
    if (/^\/zones\/[^/]+\/bot_management$/.test(pathname)) {
      if (method === 'GET') return { status: 200, result: { fight_mode: state.botFightMode } };
      if (method === 'PUT') {
        state.botFightMode = !!body.fight_mode;
        return { status: 200, result: { fight_mode: state.botFightMode } };
      }
    }
    return { status: 404 };
  }

  const isMutation = (/** @type {string} */ m) => m !== 'GET';
  const delay = () => (opts.mutationDelayMs ? new Promise((r) => setTimeout(r, opts.mutationDelayMs)) : undefined);

  /** @param {{ status: number, result?: any }} r */
  const envelope = (r) =>
    r.status >= 200 && r.status < 300
      ? { status: r.status, json: { success: true, errors: [], result: r.result } }
      : { status: r.status, json: { success: false, errors: [{ code: r.status, message: 'fake refusal' }], result: null } };

  return {
    state,
    log,
    /** Типові отвори: наступні виклики категорії відповідають цим статусом. */
    /** @param {string} category @param {number} status */
    refuse(category, status) {
      refusals[category] = status;
    },
    /** @param {Partial<typeof state>} seed */
    seed(seed) {
      Object.assign(state, seed);
    },
    mutations: () => log.filter((l) => isMutation(l.method)),
    /** @type {typeof globalThis.fetch} */
    fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? 'GET';
      if (isMutation(method)) await delay();
      const body = init?.body ? JSON.parse(String(init.body)) : undefined;
      const { status, json } = envelope(handle(method, url.pathname.replace(/^\/client\/v4/, ''), url.searchParams, body));
      return new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
    },
    /** Loopback HTTP-сервер над тим самим станом (для кількох процесів). */
    async listen() {
      const server = createServer((req, res) => {
        /** @type {Buffer[]} */
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', async () => {
          const url = new URL(req.url ?? '/', 'http://127.0.0.1');
          const method = req.method ?? 'GET';
          if (isMutation(method)) await delay();
          const raw = Buffer.concat(chunks).toString('utf8');
          const { status, json } = envelope(handle(method, url.pathname.replace(/^\/client\/v4/, ''), url.searchParams, raw ? JSON.parse(raw) : undefined));
          res.writeHead(status, { 'content-type': 'application/json' });
          res.end(JSON.stringify(json));
        });
      });
      await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
      const addr = /** @type {import('node:net').AddressInfo} */ (server.address());
      return {
        url: `http://127.0.0.1:${addr.port}`,
        close: () => new Promise((r) => server.close(() => r(undefined))),
      };
    },
  };
}
