// @ts-check
// Єдине місце конфігурації операцій: середовища, захищені хости, заборонені цілі, імена секретів.

/**
 * @typedef {{
 *   workerEnv: string,
 *   serverSteps: boolean,
 *   mainDomain?: boolean,
 *   freeze?: boolean,
 *   siteHost?: string,
 *   nodeDir?: string,
 *   project?: string,
 *   localProject?: string,
 *   distDir?: string,
 *   buildEnv?: Record<string, string>,
 * }} OpsEnv
 */

/** @type {Record<string, OpsEnv>} */
export const ENVS = {
  rehearsal: {
    siteHost: 'rehearsal.time2fest.com',
    workerEnv: 'rehearsal',
    serverSteps: true,
    nodeDir: '/srv/t2f/rehearsal',
    project: 't2f-rehearsal',
    localProject: 't2f-node-rehearsal',
    distDir: 'out-edge-rehearsal',
    buildEnv: { NEXT_PUBLIC_ENV: 'test', NEXT_PUBLIC_API_MODE: 'http' },
  },
  // Лише Worker: сервера в prelaunch немає.
  prelaunch: {
    workerEnv: 'prelaunch',
    serverSteps: false,
    mainDomain: true,
  },
  production: {
    workerEnv: 'production',
    serverSteps: true,
    mainDomain: true,
    freeze: true,
    nodeDir: '/srv/t2f/production',
  },
};

/** Хости робочого домену (той самий перелік, що `infra/cloudflare/lib/config.mjs`). */
export const MAIN_HOSTS = ['time2fest.com', 'www.time2fest.com', 'admin.time2fest.com'];

/** Старий продакшн-сервер: жодна команда не діє на нього за жодних прапорців (AC-22). */
export const FORBIDDEN_TARGETS = ['178.20.157.85'];

/**
 * Вікно заморозки production (UTC): з 31.12 08:00 до 01.01 14:00 наступного року, без `--emergency` — відмова (AC-23).
 * Місяць — 0-based, як у `Date`.
 */
export const FREEZE_WINDOW = {
  start: { month: 11, day: 31, hour: 8 },
  end: { month: 0, day: 1, hour: 14 },
};

/** Імена змінних, значення яких ніколи не потрапляють у вивід, журнал чи артефакти (NFR-4). */
export const SECRET_ENV_NAMES = [
  'CLOUDFLARE_API_TOKEN',
  'CLOUDFLARE_API_TOKEN_INFRA',
  'DATABASE_URI',
  'DIGITALOCEAN_TOKEN',
  'PAYLOAD_SECRET',
  'POSTGRES_PASSWORD',
  'T2F_EDGE_SECRET',
  'T2F_EDGE_SECRET_PREVIOUS',
  'T2F_OWNER_EMAILS',
  'TUNNEL_TOKEN',
];
