// @ts-check
// Єдине місце конфігурації інфраструктури Cloudflare: середовища, захищені хости, винятки шляхів.

/** Хости робочого домену: скрипт не змінює нічого, що їх стосується, без `--allow-main-domain`. */
export const MAIN_HOSTS = ['time2fest.com', 'www.time2fest.com', 'admin.time2fest.com'];

/**
 * Опубліковані адреси, з яких PayPro Global надсилає IPN (вебхуки).
 * Джерело: developers.payproglobal.com, сторінка Webhook IPN; перевірено 2026-11-17.
 * Змінилися там → змінити тут і перезапустити `cf.mjs apply`.
 */
export const PAYPRO_IPN_SOURCES = ['198.199.123.239', '157.230.8.40', '2604:a880:400:d0::1843:7001', '2604:a880:400:d1::b6c:c001'];

/**
 * Єдиний реєстр шляхів, для яких край пропускає захист (Skip + конфіг-правило).
 * `envs` — 'all' або перелік середовищ; `sources` — якщо задано, виняток діє лише для цих адрес джерела.
 * @type {{ path: string, envs: 'all' | string[], sources?: string[] }[]}
 */
export const EXEMPT_PATHS = [
  { path: '/api/webhooks/paypro', envs: 'all', sources: PAYPRO_IPN_SOURCES },
  // Лише хост тестового середовища і без умови на адресу: так виняток перевіряється наживо.
  { path: '/api/_test/edge-echo', envs: ['test'] },
];

/**
 * Лише `test` у цій хвилі.
 * @type {Record<string, { siteHost: string, tunnelHost: string, tunnelName: string, originService: string, underAttack: boolean }>}
 */
export const ENVS = {
  test: {
    siteHost: 'test.time2fest.com',
    tunnelHost: 'o-test.time2fest.com',
    tunnelName: 't2f-test',
    // Порт 4100 — слот 10 цього worktree (server/scripts/lib/worktree.mjs).
    originService: 'http://host.docker.internal:4100',
    underAttack: false,
  },
};

export const PHASE_CUSTOM = 'http_request_firewall_custom';
export const PHASE_CONFIG = 'http_config_settings';

export const REQUIRED_ENV = ['CLOUDFLARE_API_TOKEN_INFRA', 'CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_ZONE_ID'];

/** Дозволи токена `CLOUDFLARE_API_TOKEN_INFRA`. */
export const PERMISSIONS = [
  'Account · Cloudflare Tunnel · Edit',
  'Zone · DNS · Edit',
  'Zone · Zone WAF · Edit',
  'Zone · Config Rules · Edit',
  'Zone · Zone Settings · Read (Edit лише з --allow-zone-settings)',
  'Zone · Bot Management · Read',
];

/** Імена змінних, значення яких ніколи не потрапляють у вивід. */
export const SECRET_ENV_NAMES = ['CLOUDFLARE_API_TOKEN_INFRA', 'CLOUDFLARE_API_TOKEN', 'T2F_EDGE_SECRET', 'TUNNEL_TOKEN'];

/**
 * @param {string} envName
 * @returns {{ path: string, envs: 'all' | string[], sources?: string[] }[]}
 */
export function exemptPathsFor(envName) {
  return EXEMPT_PATHS.filter((e) => e.envs === 'all' || e.envs.includes(envName));
}
