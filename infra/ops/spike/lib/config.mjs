// @ts-check
// Єдине місце конфігурації спайку П-RT (docs/backend/spike-rt-plan.md): теги, розміри й ціни плану (§6), межі життя й
// вартості, імена в Cloudflare (§7), сценарії (§4) і пороги (§5). Лише назви змінних — жодних значень секретів.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Корінь репозиторію `web/`. */
export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

export const TAG_MANAGED = 't2f-managed';
export const TAG_ENV = 't2f-env-spike';
export const ROLE_TAGS = /** @type {const} */ ({ realtime: 't2f-role-realtime', loadgen: 't2f-role-loadgen' });
/** Обидва теги, без яких вузол спайку не видаляється й не вважається вузлом спайку. */
export const REQUIRED_TAGS = [TAG_MANAGED, TAG_ENV];

/** Вузли (план §2): 1 × realtime c-8 у fra1 і 4 генератори s-4vcpu-8gb (2 × fra1, 2 × ams3). */
export const NODES = {
  realtime: { name: 't2f-spike-realtime', size: 'c-8', region: 'fra1' },
  loadgen: { namePrefix: 't2f-spike-gen-', size: 's-4vcpu-8gb', regions: ['fra1', 'fra1', 'ams3', 'ams3'] },
};

/** Ціни плану §6 ($/год); API дорожче більш ніж на 10% — відмова. */
export const PLAN_PRICES = /** @type {Record<string, number>} */ ({ 'c-8': 0.25, 's-4vcpu-8gb': 0.071 });
export const PRICE_TOLERANCE = 0.1;
/** Очікувані години життя вузлів (план §6). */
export const EXPECTED_HOURS = { realtime: 4, loadgen: 3.5 };
/** Стеля: ≤ 6 год життя вузлів, ≤ $8 разом (план §6). */
export const LIFETIME_HOURS = 6;
export const COST_CEILING = 8;

/** Cloudflare (план §7): лише ці три ресурси створюються й видаляються. */
export const CF = {
  host: 'rt-spike.time2fest.com',
  origin: 'https://rt-spike.time2fest.com',
  tunnelName: 't2f-rtspike',
  ingressPath: '^/connection/',
  service: 'http://centrifugo:8000',
  rulePrefix: 't2f-spike:',
  ruleDescription: 't2f-spike: rt-spike security off (П-RT)',
  ruleExpression: '(http.host eq "rt-spike.time2fest.com")',
  phase: 'http_config_settings',
};
export const CF_ENV = { token: 'CLOUDFLARE_API_TOKEN_INFRA', account: 'CLOUDFLARE_ACCOUNT_ID', zone: 'CLOUDFLARE_ZONE_ID' };

/** Вузол realtime: каталог, проєкт Compose, імена контейнерів. */
export const NODE_DIR = '/srv/t2f/spike';
export const PROJECT = 't2f-spike';
export const COMPOSE_FILE = 'compose.rtspike.yml';
export const CONTAINERS = {
  centrifugo: `${PROJECT}-centrifugo-1`,
  cloudflaredA: `${PROJECT}-cloudflared-a-1`,
  cloudflaredB: `${PROJECT}-cloudflared-b-1`,
  publisher: `${PROJECT}-publisher-1`,
  k6: 't2f-spike-k6',
};
/** Той самий закріплений образ k6, що `server/scripts/k6.mjs`. */
export const K6_IMAGE = 'grafana/k6:2.4.0';

/** Локальні файли (не в git): `infra/ops/.local/spike/`. */
export const STATE_DIR = path.join(REPO_ROOT, 'infra', 'ops', '.local', 'spike');
export const FILES = {
  compose: path.join(REPO_ROOT, 'infra', 'ops', 'node', COMPOSE_FILE),
  collector: path.join(REPO_ROOT, 'infra', 'ops', 'node', 'rtspike-collector.sh'),
  k6Dir: path.join(REPO_ROOT, 'server', 'load', 'realtime'),
  k6Scripts: ['spike.js', 'spike-publisher.js'],
};
/** Змінні, значення яких маскуються (крім `SECRET_ENV_NAMES` ops). */
export const SPIKE_SECRET_FILES = ['redis.env', 'centrifugo.env'];

/**
 * Сценарії (план §4). Секунди. `restart` — що перезапускається і коли (від спільного старту).
 * @typedef {{
 *   conns: number, rampSec: number, holdSec: number, batchMs: number, batchMs2: number, fastLastSec: number,
 *   storm?: { atSec: number, windowSec: number }, restart?: { target: 'centrifugo' | 'cloudflared', atSec: number },
 *   title: string,
 * }} Scenario
 * @type {Record<string, Scenario>}
 */
export const SCENARIOS = {
  S0: { title: 'димовий: 1 000 з’єднань, 5 хв, публікація', conns: 1000, rampSec: 60, holdSec: 300, batchMs: 500, batchMs2: 250, fastLastSec: 0 },
  S1: { title: 'ключовий: 0 → 30 000 за 5 хв, утримання 20 хв, останні 3 хв — 250 мс', conns: 30000, rampSec: 300, holdSec: 1200, batchMs: 500, batchMs2: 250, fastLastSec: 180 },
  S2: { title: 'шквал: усі рвуть у вікні 10 с і одразу повертаються', conns: 30000, rampSec: 300, holdSec: 180, batchMs: 500, batchMs2: 250, fastLastSec: 0, storm: { atSec: 360, windowSec: 10 } },
  S3: { title: 'перезапуск Centrifugo під навантаженням', conns: 30000, rampSec: 300, holdSec: 300, batchMs: 500, batchMs2: 250, fastLastSec: 0, restart: { target: 'centrifugo', atSec: 360 } },
  S4: { title: 'перезапуск однієї копії cloudflared', conns: 30000, rampSec: 300, holdSec: 180, batchMs: 500, batchMs2: 250, fastLastSec: 0, restart: { target: 'cloudflared', atSec: 360 } },
};

/** Пороги плану §5: [зелений, жовтий]; гірше за жовтий — червоний. */
export const THRESHOLDS = {
  connectedPct: [99.9, 99],
  dropsPct: [0.1, 1],
  p95Ms: [1000, 2000],
  p99Ms: [2000, 4000],
  returnSec: [60, 120],
  recoveredPct: [99, 97],
  nodeCpuPct: [60, 85],
  /** Межа довіри генератора: CPU вище — прогін «недостовірний». */
  genCpuPct: 85,
  /** Частка помилок рукостискання 5xx/52x серед цільових, понад яку — «масові» (червоний). */
  mass5xxPct: 1,
};
