/** Error model of the seam, shared by web and server (moved verbatim from web/lib/api/result.ts). */

/** Коди помилок, спільні для всіх доменів. Доменні причини — у `reason` (наприклад, `slow-mode` чату). */
export type ApiErrorCode =
  /** Немає мережі чи сервер не відповів (тайм-аут, 5xx). Можна повторити. */
  | 'network'
  /** Сервіс тимчасово вимкнено (обслуговування, «чат недоступний», режим без бекенду). */
  | 'unavailable'
  /** Потрібен вхід (немає сесії чи вона прострочена). */
  | 'unauthorized'
  /** Сесія є, але дія заборонена (бан у чаті, чужий ресурс). */
  | 'forbidden'
  | 'not_found'
  /** Стан на сервері не дозволяє дію (пас уже є, оцінювання закрито, оплата вже йде). */
  | 'conflict'
  /** Ліміт частоти (повільний режим, листи входу). `retryAfterMs` — коли можна знову. */
  | 'rate_limited'
  /** Сервер відхилив дані (посилання в тексті, задовгий нік). `reason` — що саме. */
  | 'validation'
  | 'unknown';

export interface ApiError {
  code: ApiErrorCode;
  /** Доменна причина: `link-forbidden`, `taken`, `expired`, `too-many`… Перелік — у контракті домену. */
  reason?: string;
  retryAfterMs?: number;
  /** Код із листа: скільки спроб лишилось (`reason: 'wrong-code'`). */
  attemptsLeft?: number;
  /** Для журналу, не для людини: тексти інтерфейсу беремо з `messages/*.json` за `code`/`reason`. */
  message?: string;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; error: ApiError };

export function ok<T>(value: T): ApiResult<T> {
  return { ok: true, value };
}

export function fail<T = never>(code: ApiErrorCode, extra: Omit<ApiError, 'code'> = {}): ApiResult<T> {
  return { ok: false, error: { code, ...extra } };
}

/** Відписка від realtime-підписки (канал Centrifugo в `http`, підписка на стор у `sim`). */
export type Unsubscribe = () => void;
