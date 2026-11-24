/**
 * Очищення деталей тривоги (SPEC-13b AC-11), ring 1 — чисті функції.
 *
 * До Telegram і в `alarms.details` / `alarm-deliveries.details` потрапляють лише ключі з білого списку
 * рядка реєстру (`OpsAlarmRow.detailKeys`, `registries/ops.ts`) зі значеннями-числами чи кодами
 * `[A-Za-z0-9_.:-/]{1,64}`. Код додатково відкидає те, що схоже на email, IPv4 / IPv6, токен бота
 * (`bot<id>:` чи `<id>:<секрет>`), URL, і будь-яке значення, що містить відомий секрет середовища
 * (`secretValues`: значення змінних із `secret: true`). Відкинуте значення просто зникає — без заміни
 * на позначку, щоб навіть довжина чи форма не витікали.
 */
import { isIP } from 'node:net';
import type { AlarmDetails } from '../../alarms/ports';

const CODE_VALUE = /^[A-Za-z0-9_.:\-/]{1,64}$/;
const IPV4_INSIDE = /(?:^|[^0-9])(?:\d{1,3}\.){3}\d{1,3}(?:[^0-9]|$)/;
const BOT_TOKEN = /bot\d+:/i;
const TOKEN_SHAPE = /\d{5,}:[A-Za-z0-9_-]{20,}/;
const URL_SCHEME = /[A-Za-z][A-Za-z0-9+.-]*:\/\//;
/** Секрет коротший за це не шукається всередині значень: інакше «1» вирізав би всі числа-коди. */
const MIN_SECRET_LENGTH = 6;

export interface SanitizeOptions {
  /** Значення секретних змінних середовища; значення деталей, що містить будь-яке з них, відкидається. */
  secretValues?: readonly string[];
}

/** Чи є рядок IPv6 (повністю чи як частина `a/b`, `x:y`-коду). */
function looksLikeIpv6(value: string): boolean {
  if (isIP(value) === 6) return true;
  return value.split(/[/]/).some((part) => isIP(part) === 6);
}

/** Чи може рядок-код піти в повідомлення (AC-11). */
export function isSafeCode(value: string, secretValues: readonly string[] = []): boolean {
  if (!CODE_VALUE.test(value)) return false;
  if (value.includes('@')) return false;
  if (IPV4_INSIDE.test(value) || isIP(value) !== 0 || looksLikeIpv6(value)) return false;
  if (BOT_TOKEN.test(value) || TOKEN_SHAPE.test(value)) return false;
  if (URL_SCHEME.test(value) || value.startsWith('//')) return false;
  for (const secret of secretValues) {
    if (secret.length >= MIN_SECRET_LENGTH && value.includes(secret)) return false;
  }
  return true;
}

/**
 * Лише ключі з `allowKeys` (білий список рядка реєстру; для незареєстрованого виду — порожній), значення —
 * скінченні числа або безпечні коди. Порядок ключів — порядок `allowKeys`, тож текст стабільний.
 * Повертає `undefined`, коли нічого не лишилось.
 */
export function sanitizeDetails(
  details: unknown,
  allowKeys: readonly string[],
  options: SanitizeOptions = {},
): AlarmDetails | undefined {
  if (details === null || typeof details !== 'object' || Array.isArray(details)) return undefined;
  const source = details as Record<string, unknown>;
  const secrets = options.secretValues ?? [];
  const out: Record<string, string | number> = {};
  for (const key of allowKeys) {
    if (!Object.prototype.hasOwnProperty.call(source, key)) continue;
    const value = source[key];
    if (typeof value === 'number') {
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === 'string' && isSafeCode(value, secrets)) {
      out[key] = value;
    }
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
