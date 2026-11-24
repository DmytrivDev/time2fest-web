/**
 * Справжній адаптер Telegram Bot API (ring 4, SPEC-13b AC-13, AC-14, AC-15; NFR-4, NFR-5) — єдиний файл, що
 * знає форму `sendMessage`. `POST <api base>/bot<token>/sendMessage` з `{chat_id, text, disable_web_page_preview:true}`
 * (без `parse_mode`), тайм-аут 10 с.
 *
 * Ніколи не кидає: кожна відмова — результат (`AlarmSink`). Відповіді: 200 → `ok`; 429 → `retry` з `retry_after`
 * (≤300 с); 5xx і помилка мережі чи тайм-аут → `retry`; інші 4xx (400 «chat not found», 401, 403) → `fatal`.
 * Токен живе лише в URL, що будується в мить запиту: URL, тіло запиту й відповіді, текст помилки мережі
 * ніколи не потрапляють у лог, помилку чи результат — лише статус і назва класу помилки.
 *
 * `selectTelegramSink` обирає сток за класом середовища через `telegramRoute` (W7): справжній Telegram у
 * тестах недосяжний — `test` пускає лише loopback (і мережевий запобіжник `test/support/noTelegramNetwork.ts`).
 */
import type { AlarmDeliveryOutcome, AlarmMessage, AlarmSink } from '../alarms/ports';
import { RETRY_AFTER_CAP_S } from '../domain/ops/delivery';
import { telegramRoute, type TelegramDisabled } from '../domain/ops/route';
import { isLoopbackUrl, type EnvClass } from '../platform/env';
import type { Logger } from '../ports';

export const TELEGRAM_TIMEOUT_MS = 10_000;

export interface TelegramSinkOptions {
  /** Напр. `https://api.telegram.org` або URL фейка на loopback. */
  apiBase: string;
  token: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** Один рядок `warn` на невдалу спробу: лише результат, статус і назва класу помилки. */
  log?: Logger;
}

/** `retry_after` з тіла 429 (`parameters.retry_after`) чи заголовка `Retry-After`; ≤ `RETRY_AFTER_CAP_S`. */
function retryAfterOf(body: unknown, header: string | null): number | undefined {
  let raw: unknown;
  if (body !== null && typeof body === 'object') {
    const params = (body as { parameters?: unknown }).parameters;
    if (params !== null && typeof params === 'object') raw = (params as { retry_after?: unknown }).retry_after;
  }
  if (raw === undefined && header !== null) raw = Number(header);
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw <= 0) return undefined;
  return Math.min(Math.ceil(raw), RETRY_AFTER_CAP_S);
}

function outcomeOf(status: number, body: unknown, retryAfterHeader: string | null): AlarmDeliveryOutcome {
  if (status >= 200 && status < 300) {
    const ok = body !== null && typeof body === 'object' && (body as { ok?: unknown }).ok === true;
    return ok ? { result: 'ok', status } : { result: 'retry', status };
  }
  if (status === 429) {
    const retryAfterSec = retryAfterOf(body, retryAfterHeader);
    return retryAfterSec === undefined ? { result: 'retry', status } : { result: 'retry', retryAfterSec, status };
  }
  if (status >= 500) return { result: 'retry', status };
  return { result: 'fatal', status };
}

/** Назва класу помилки без тексту (текст помилки мережі може містити адресу). */
function errorName(err: unknown): string {
  if (err instanceof Error && /^[A-Za-z]+$/.test(err.name)) return err.name;
  return 'Error';
}

export function createTelegramSink(options: TelegramSinkOptions): AlarmSink {
  const doFetch = options.fetch ?? globalThis.fetch;
  const timeoutMs = options.timeoutMs ?? TELEGRAM_TIMEOUT_MS;
  const base = options.apiBase.replace(/\/+$/, '');
  const token = options.token;
  const log = options.log;

  return {
    async deliver(msg: AlarmMessage): Promise<AlarmDeliveryOutcome> {
      let outcome: AlarmDeliveryOutcome;
      let cause: string | undefined;
      try {
        const res = await doFetch(`${base}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: msg.chatId, text: msg.text, disable_web_page_preview: true }),
          signal: AbortSignal.timeout(timeoutMs),
          redirect: 'error',
        });
        let body: unknown = null;
        try {
          body = await res.json();
        } catch {
          body = null;
        }
        outcome = outcomeOf(res.status, body, res.headers.get('retry-after'));
      } catch (err) {
        cause = errorName(err);
        outcome = { result: 'retry' };
      }
      if (outcome.result !== 'ok' && log) {
        const fields: Record<string, unknown> = { event: 'ops/telegram-send-failed', result: outcome.result };
        if (outcome.status !== undefined) fields.status = outcome.status;
        if (outcome.retryAfterSec !== undefined) fields.retryAfterSec = outcome.retryAfterSec;
        if (cause !== undefined) fields.cause = cause;
        log.warn(fields);
      }
      return outcome;
    },
  };
}

export type TelegramSelection =
  | { sink: AlarmSink; chatId: string }
  | { sink: null; disabled: TelegramDisabled; missing?: readonly string[] };

export interface SelectTelegramSinkDeps {
  log: Logger;
  fetch?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Сток за класом (AC-13, AC-14). Вимкнений сток → `sink: null` і один рядок `ops/telegram-not-configured` з
 * причиною й назвами відсутніх змінних (ніколи значень); заданий на `test`/`rehearsal` чат власника → один
 * рядок `ops/telegram-owner-chat-ignored`. Тривогу `ops/telegram-not-configured` піднімає проводка (W14).
 */
export function selectTelegramSink(
  cls: EnvClass,
  env: Readonly<Record<string, unknown>>,
  deps: SelectTelegramSinkDeps,
): TelegramSelection {
  const route = telegramRoute(cls, env, isLoopbackUrl);
  if (route.warn === 'owner-chat-ignored') {
    deps.log.warn({ event: 'ops/telegram-owner-chat-ignored', class: cls, variable: 'T2F_TELEGRAM_CHAT_ID' });
  }
  if ('disabled' in route) {
    const fields: Record<string, unknown> = { event: 'ops/telegram-not-configured', class: cls, reason: route.disabled };
    if (route.missing !== undefined) fields.missing = [...route.missing];
    deps.log.warn(fields);
    return route.missing === undefined ? { sink: null, disabled: route.disabled } : { sink: null, disabled: route.disabled, missing: route.missing };
  }
  const sinkOptions: TelegramSinkOptions = {
    apiBase: route.apiBase,
    token: String(env.T2F_TELEGRAM_BOT_TOKEN).trim(),
    log: deps.log,
  };
  if (deps.fetch !== undefined) sinkOptions.fetch = deps.fetch;
  if (deps.timeoutMs !== undefined) sinkOptions.timeoutMs = deps.timeoutMs;
  return { sink: createTelegramSink(sinkOptions), chatId: route.chatId };
}
