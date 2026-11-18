// @ts-check
import { ENVS, PHASE_CONFIG, PHASE_CUSTOM, exemptPathsFor } from './config.mjs';

/** Ingress тунелю пропускає до джерела лише API; решта шляхів (`/admin`, `/cms-api/*` …) — 404 у тунелі. */
export const TUNNEL_PATH = '^/api/';
/**
 * Ingress адмінки: лише шляхи Payload — сторінки адмінки (`/admin`), REST (`/cms-api`) і статика Next.js (`/_next`);
 * решта — 404 у тунелі. `/admin` і `/cms-api` — з SPEC-04 і `docs/backend/cloudflare-notes.md` §3; `/_next` —
 * статика адмінки Payload на Next.js (наживо ще не звірено).
 */
export const ADMIN_PATH = '^/(admin|cms-api|_next)(/|$)';
/** Ingress realtime: лише транспорти клієнта Centrifugo (`/connection/websocket` тощо); решта — 404 у тунелі. */
export const REALTIME_PATH = '^/connection/';

/** @param {string[]} items */
const set = (items) => `{${items.map((i) => `"${i}"`).join(' ')}}`;

/**
 * Імена адмінки середовищ, для яких адмінку не ввімкнено (`admin[env] !== true`): їх стежать як можливі залишки.
 * @param {string[]} envNames
 * @param {Record<string, boolean | undefined>} [admin]
 * @returns {string[]}
 */
export function disabledAdminHosts(envNames, admin = {}) {
  return envNames.flatMap((n) => {
    const h = ENVS[n]?.adminHost;
    return h && admin[n] !== true ? [h] : [];
  });
}

/**
 * Бажаний стан для вказаних середовищ. Кожен вираз правила називає хости.
 * @param {string[]} envNames
 * @param {{
 *   underAttack?: boolean | Record<string, boolean | undefined>,
 *   admin?: Record<string, boolean | undefined>,
 *   staleAdmin?: string[],
 * }} [opts] `underAttack` перекриває типове значення середовища: булеве — для всіх, мапа — по середовищу
 *   (`undefined` → типове). `admin[env] === true` — ім’я адмінки (ingress і CNAME) входить у бажаний стан; інакше його
 *   немає взагалі (адмінка з’являється лише разом із застосунком Access). `staleAdmin` — імена адмінки без Access, які
 *   вже є в Cloudflare (запис DNS чи ingress): вони йдуть у блок-правило.
 */
export function desiredState(envNames, opts = {}) {
  const envs = envNames.map((n) => {
    const e = ENVS[n];
    if (!e) throw new Error(`невідоме середовище: ${n}`);
    return { name: n, ...e };
  });
  const tunnelHosts = envs.map((e) => e.tunnelHost);
  /** @param {{ name: string, adminHost?: string }} e @returns {string[]} */
  const adminOf = (e) => (e.adminHost && opts.admin?.[e.name] === true ? [e.adminHost] : []);
  /** @param {{ realtimeHost?: string, realtimeService?: string }} e @returns {{ host: string, service: string }[]} */
  const realtimeOf = (e) => (e.realtimeHost && e.realtimeService ? [{ host: e.realtimeHost, service: e.realtimeService }] : []);
  const disabled = new Set(disabledAdminHosts(envNames, opts.admin));
  const blockedAdmin = [...new Set(opts.staleAdmin ?? [])].filter((h) => disabled.has(h));
  // По умові на кожен шлях-виняток: хости середовищ, де він діє, і (якщо задано) адреси джерела.
  const seen = new Set();
  const clauses = envs
    .flatMap((e) => exemptPathsFor(e.name))
    .filter((x) => !seen.has(x.path) && seen.add(x.path))
    .map((x) => {
      const hosts = envs.filter((e) => exemptPathsFor(e.name).includes(x)).map((e) => e.siteHost);
      const src = x.sources ? ` and ip.src in {${x.sources.join(' ')}}` : '';
      return `(http.host in ${set(hosts)} and http.request.uri.path eq "${x.path}"${src})`;
    });
  if (!clauses.length) throw new Error('немає шляхів-винятків для вибраних середовищ');
  const exemptExpr = clauses.length === 1 ? clauses[0] : `(${clauses.join(' or ')})`;

  const tunnels = envs.map((e) => ({
    env: e.name,
    name: e.tunnelName,
    hostname: e.tunnelHost,
    ingress: [
      { hostname: e.tunnelHost, path: TUNNEL_PATH, service: e.originService },
      // Адмінка — лише шляхи Payload і лише разом з Access; у блок-правило не входить: її закривають Access і JWT.
      ...adminOf(e).map((hostname) => ({ hostname, path: ADMIN_PATH, service: e.originService })),
      // Realtime — клієнтський порт Centrifugo; у блок-правило не входить (публічне ім'я, як сайт).
      ...realtimeOf(e).map((r) => ({ hostname: r.host, path: REALTIME_PATH, service: r.service })),
      { service: 'http_status:404' },
    ],
  }));

  const dns = envs.flatMap((e) =>
    [e.tunnelHost, ...adminOf(e), ...realtimeOf(e).map((r) => r.host)].map((name) => ({
      env: e.name,
      name,
      type: 'CNAME',
      tunnelName: e.tunnelName,
      proxied: true,
    })),
  );

  /** @type {any[]} */
  const custom = [
    {
      ref: 't2f-skip-exempt',
      description: 't2f: skip security for exempt paths',
      expression: exemptExpr,
      action: 'skip',
      action_parameters: {
        ruleset: 'current',
        phases: ['http_ratelimit', 'http_request_firewall_managed'],
        products: ['securityLevel', 'bic', 'uaBlock', 'zoneLockdown', 'hot'],
      },
      enabled: true,
    },
    {
      ref: 't2f-block-tunnel-hosts',
      description: 't2f: block direct access to tunnel hosts',
      // Імена тунелів і залишки адмінки без Access (запис DNS чи ingress є, застосунку Access немає).
      expression: `(http.host in ${set([...tunnelHosts, ...blockedAdmin])})`,
      action: 'block',
      enabled: true,
    },
  ];

  /** @type {any[]} */
  const config = [
    ...envs.map((e) => ({
      ref: `t2f-under-attack-${e.name}`,
      description: `t2f: Under Attack toggle for ${e.name}`,
      expression: `(http.host eq "${e.siteHost}")`,
      action: 'set_config',
      action_parameters: { security_level: 'under_attack' },
      enabled: (typeof opts.underAttack === 'object' ? opts.underAttack[e.name] : opts.underAttack) ?? e.underAttack,
    })),
    // Realtime: перевірки браузера й рівень безпеки ламають WebSocket-клієнт (cloudflare-notes §85).
    ...envs.flatMap((e) =>
      realtimeOf(e).map((r) => ({
        ref: `t2f-realtime-${e.name}`,
        description: `t2f: realtime host security off for ${e.name}`,
        expression: `(http.host eq "${r.host}")`,
        action: 'set_config',
        action_parameters: { security_level: 'off', bic: false },
        enabled: true,
      })),
    ),
    // Останнє правило перемагає: винятки шляхів не підпадають під Under Attack.
    {
      ref: 't2f-exempt-config',
      description: 't2f: relax security level for exempt paths',
      expression: exemptExpr,
      action: 'set_config',
      action_parameters: { security_level: 'essentially_off', bic: false },
      enabled: true,
    },
  ];

  return {
    tunnels,
    dns,
    /** @type {Record<string, any[]>} */
    rulesets: { [PHASE_CUSTOM]: custom, [PHASE_CONFIG]: config },
    /** Лише перевіряється; пишеться тільки з `--allow-zone-settings`. */
    zone: { pseudo_ipv4: 'off', bot_fight_mode: false },
  };
}
