/**
 * Куди йдуть тривоги в Telegram за класом середовища (SPEC-13b AC-13, AC-14), ring 1 — чиста функція.
 *
 * - `test` — лише фейк: `T2F_TELEGRAM_API_BASE` на loopback; без нього чи з нелокальною адресою сток
 *   вимкнено (справжній Telegram з тестів недосяжний). Чат — `T2F_TELEGRAM_TEST_CHAT_ID`.
 * - `rehearsal` — лише `T2F_TELEGRAM_TEST_CHAT_ID`; заданий чат власника ігнорується з одним попередженням.
 * - `production` — лише `T2F_TELEGRAM_CHAT_ID`.
 * Без токена чи потрібного чату — `not-configured` з назвами змінних (ніколи значень). Поза `test` адреса
 * API — лише точно `https://api.telegram.org` (токен їде в шляху, AC-15; безпека S-2): не `https:` →
 * `insecure-base`, інший хост/порт/шлях → `foreign-base`. Токен функція не повертає: його бере адаптер.
 * Перевірку loopback передає виклик (`isLoopbackUrl` з platform/env) — домен не тягне platform (A-1).
 */
import type { EnvClass } from '../../platform/env';

export const TELEGRAM_DEFAULT_API_BASE = 'https://api.telegram.org';

export type TelegramDisabled = 'not-configured' | 'non-loopback' | 'insecure-base' | 'foreign-base';

export type TelegramRoute =
  | { chatId: string; apiBase: string; warn?: 'owner-chat-ignored' }
  | { disabled: TelegramDisabled; missing?: readonly string[]; warn?: 'owner-chat-ignored' };

/** Чи адреса — loopback (фейк Telegram); інʼєктується з platform/env. */
export type LoopbackCheck = (value: unknown) => boolean;

function present(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '';
}

/** Поза `test`: лише `https://api.telegram.org` (необовʼязково з кінцевим `/`), без облікових даних, запиту, якоря. */
function realBaseProblem(base: string): 'insecure-base' | 'foreign-base' | undefined {
  let url: URL;
  try {
    url = new URL(base);
  } catch {
    return 'insecure-base';
  }
  if (url.protocol !== 'https:') return 'insecure-base';
  const exact =
    url.origin === TELEGRAM_DEFAULT_API_BASE &&
    url.username === '' &&
    url.password === '' &&
    url.pathname === '/' &&
    url.search === '' &&
    url.hash === '';
  return exact ? undefined : 'foreign-base';
}

export function telegramRoute(cls: EnvClass, env: Readonly<Record<string, unknown>>, isLoopbackUrl: LoopbackCheck): TelegramRoute {
  const chatVar = cls === 'production' ? 'T2F_TELEGRAM_CHAT_ID' : 'T2F_TELEGRAM_TEST_CHAT_ID';
  const warn = cls !== 'production' && present(env.T2F_TELEGRAM_CHAT_ID) ? ({ warn: 'owner-chat-ignored' } as const) : {};
  const base = env.T2F_TELEGRAM_API_BASE;

  if (cls === 'test') {
    if (!present(base)) return { disabled: 'non-loopback', missing: ['T2F_TELEGRAM_API_BASE'], ...warn };
    if (!isLoopbackUrl(base)) return { disabled: 'non-loopback', ...warn };
  } else if (present(base)) {
    const problem = realBaseProblem(base);
    if (problem !== undefined) return { disabled: problem, ...warn };
  }

  const missing = ['T2F_TELEGRAM_BOT_TOKEN', chatVar].filter((name) => !present(env[name]));
  if (missing.length > 0) return { disabled: 'not-configured', missing, ...warn };

  return {
    chatId: String(env[chatVar]).trim(),
    apiBase: cls === 'test' && present(base) ? base : TELEGRAM_DEFAULT_API_BASE,
    ...warn,
  };
}
