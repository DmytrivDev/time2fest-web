// @ts-check
// Єдине місце конфігурації операцій: середовища, захищені хости, заборонені цілі, імена секретів, типові шляхи.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корінь репозиторію (worktree). */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

/**
 * @typedef {{
 *   workerEnv: string,
 *   serverSteps: boolean,
 *   mainDomain?: boolean,
 *   bootstrap?: boolean,
 *   freeze?: boolean,
 *   siteHost?: string,
 *   nodeDir?: string,
 *   project?: string,
 *   localProject?: string,
 *   distDir?: string,
 *   buildEnv?: Record<string, string>,
 * }} OpsEnv `bootstrap` — для середовища є підготовка вузла (`ops bootstrap`, вузол realtime у `capacity`).
 */

/** @type {Record<string, OpsEnv>} */
export const ENVS = {
  rehearsal: {
    siteHost: 'rehearsal.time2fest.com',
    workerEnv: 'rehearsal',
    serverSteps: true,
    bootstrap: true,
    nodeDir: '/srv/t2f/rehearsal',
    project: 't2f-rehearsal',
    localProject: 't2f-node-rehearsal',
    distDir: 'out-edge-rehearsal',
    // Realtime через край: ім'я rt-rehearsal (infra/cloudflare, тунель → centrifugo:8000).
    buildEnv: { NEXT_PUBLIC_ENV: 'test', NEXT_PUBLIC_API_MODE: 'http', NEXT_PUBLIC_SITE_CLASS: 'rehearsal', NEXT_PUBLIC_REALTIME_URL: 'wss://rt-rehearsal.time2fest.com/connection/websocket' },
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

/** Середовища з підготовкою вузла (`ENVS[env].bootstrap`): `ops bootstrap` і вузол realtime у `capacity`. */
export const BOOTSTRAP_ENVS = Object.keys(ENVS).filter((e) => ENVS[e].bootstrap === true);

/** Хости робочого домену (той самий перелік, що `infra/cloudflare/lib/config.mjs`; рівність — `test/parity.test.mjs`). */
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
  'DIGITALOCEAN_API_TOKEN',
  'PAYLOAD_SECRET',
  'POSTGRES_PASSWORD',
  'REDIS_PASSWORD',
  'REDIS_URL',
  'T2F_BACKUP_KEY',
  'T2F_EDGE_SECRET',
  'T2F_EDGE_SECRET_PREVIOUS',
  'T2F_OWNER_EMAILS',
  'T2F_R2_ACCESS_KEY_ID',
  'T2F_R2_SECRET_ACCESS_KEY',
  'T2F_TELEGRAM_BOT_TOKEN',
  'TUNNEL_TOKEN',
];

/** Профіль Compose вузла realtime (P4), відносно кореня репозиторію. */
export const REALTIME_COMPOSE_PATH = 'infra/ops/node/compose.realtime.yml';

/**
 * Локальні шляхи ops. Типові — тут; тести підміняють їх через `main(argv, { paths })`.
 * @typedef {{
 *   stateRoot: string,
 *   examplesDir: string,
 *   tunnelEnvFile: (env: string) => string,
 *   realtimeComposeFile: string,
 * }} OpsPaths `stateRoot` — локальний стан (не в git): замки й журнали локальної цілі, `known_hosts`, `.local/<env>/`;
 *   `examplesDir` — приклади файлів змінних вузла; `tunnelEnvFile` — токен тунелю середовища з `infra/cloudflare`;
 *   `realtimeComposeFile` — профіль Compose вузла realtime.
 */

/** @type {Readonly<OpsPaths>} */
export const DEFAULT_PATHS = Object.freeze({
  stateRoot: path.join(REPO_ROOT, 'infra', 'ops', '.local'),
  examplesDir: path.join(REPO_ROOT, 'infra', 'ops', 'node'),
  tunnelEnvFile: (/** @type {string} */ env) => path.join(REPO_ROOT, 'infra', 'cloudflare', '.local', `tunnel-${env}.env`),
  realtimeComposeFile: path.join(REPO_ROOT, REALTIME_COMPOSE_PATH),
});
