/**
 * Одне тестове повідомлення в тестовий канал Telegram (SPEC-13b, слово власника 2026-11-24).
 *
 * Запускає лише власник: `pnpm ops:telegram-test` з теки `web/`. Команда сама читає
 * `dashboard/secrets/.env` (TELEGRAM_BOT_TOKEN, TELEGRAM_TEST_CHAT_ID; TELEGRAM_CHAT_ID не потрібен —
 * чат власника ця команда не чіпає), шле ОДНЕ повідомлення справжнім адаптером `createTelegramSink`
 * лише в тестовий чат і друкує один рядок: «надіслано» або «помилка <код>». Жодного значення
 * із секретів не друкує — ні токена, ні id чату, ні адреси запиту.
 *
 * Адреса API — лише `https://api.telegram.org`; тести підставляють фейк через `runTelegramTest`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTelegramSink } from '../adapters/telegram';
import { realClock } from '../clock';

export const TELEGRAM_API_BASE = 'https://api.telegram.org';

/** `dashboard/secrets/.env` у корені проєкту Time2Fest (поза git-репозиторієм `web/`). */
export const DEFAULT_SECRETS_ENV = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../dashboard/secrets/.env',
);

/** Відповіді панелі: несекретні поля справ власника (id чатів зберігаються тут, не в `.env`). */
export const DEFAULT_ANSWERS_JSON = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../../../dashboard/data/answers.json',
);

/** `TELEGRAM_TEST_CHAT_ID` із поля справи `own-telegram` панелі; немає — `undefined`. */
export function testChatFromAnswers(text: string): string | undefined {
  try {
    const v = JSON.parse(text)?.fields?.['own-telegram']?.telegram_test_chat_id?.value;
    return typeof v === 'string' && v.trim() ? v.trim() : undefined;
  } catch {
    return undefined;
  }
}

const TOKEN = 'TELEGRAM_BOT_TOKEN';
const TEST_CHAT = 'TELEGRAM_TEST_CHAT_ID';

/** Мінімальний розбір `.env`: `NAME=value`, лапки знімаються, коментарі й порожні рядки пропускаються. */
export function parseEnvFile(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    const name = m?.[1];
    if (!m || !name) continue;
    let value = (m[2] ?? '').trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

export interface TelegramTestOptions {
  envPath?: string;
  answersPath?: string;
  apiBase?: string;
  fetch?: typeof fetch;
  now?: () => number;
}

/** Результат одним рядком без секретів. */
export async function runTelegramTest(options: TelegramTestOptions = {}): Promise<{ ok: boolean; line: string }> {
  const envPath = options.envPath ?? DEFAULT_SECRETS_ENV;
  let text: string;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return { ok: false, line: 'помилка no-secrets-file' };
  }
  const env = parseEnvFile(text);
  if (!env[TEST_CHAT]) {
    try {
      const fromPanel = testChatFromAnswers(fs.readFileSync(options.answersPath ?? DEFAULT_ANSWERS_JSON, 'utf8'));
      if (fromPanel) env[TEST_CHAT] = fromPanel;
    } catch {
      /* немає файлу відповідей — лишається missing */
    }
  }
  const token = env[TOKEN];
  const chatId = env[TEST_CHAT];
  const missing = [TOKEN, TEST_CHAT].filter((name) => !env[name]);
  if (!token || !chatId) return { ok: false, line: `помилка missing ${missing.join(',')}` };
  if (!/^(-?\d{1,20}|@[A-Za-z0-9_]{5,32})$/.test(chatId)) return { ok: false, line: `помилка invalid ${TEST_CHAT}` };

  const sink = createTelegramSink({ apiBase: options.apiBase ?? TELEGRAM_API_BASE, token, fetch: options.fetch });
  const at = new Date((options.now ?? realClock.now)()).toISOString().slice(0, 16).replace('T', ' ');
  const outcome = await sink.deliver({
    chatId,
    text: `Time2Fest · тест каналу тривог\nЦе перевірочне повідомлення (SPEC-13b), відповідати не треба.\n${at} UTC`,
  });
  if (outcome.result === 'ok') return { ok: true, line: 'надіслано' };
  return { ok: false, line: `помилка ${outcome.status ?? 'network'}` };
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  runTelegramTest().then(
    (r) => {
      process.stdout.write(`${r.line}\n`);
      process.exitCode = r.ok ? 0 : 1;
    },
    () => {
      process.stdout.write('помилка unexpected\n');
      process.exitCode = 1;
    },
  );
}
