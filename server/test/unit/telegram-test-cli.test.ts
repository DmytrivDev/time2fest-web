/**
 * `pnpm ops:telegram-test` (server/src/cli/telegramTest.ts): одне повідомлення лише в тестовий чат,
 * вивід — лише «надіслано» / «помилка <код>», без значень секретів. Перевірка на фейку Telegram.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeTelegram } from '../../../fakes/telegram/server.mjs';
import { DEFAULT_SECRETS_ENV, TELEGRAM_API_BASE, parseEnvFile, runTelegramTest, testChatFromAnswers } from '../../src/cli/telegramTest';

const TOKEN = 'fake-cli-token-not-real-0000'; // check-secrets: allow test fake
const OWNER_CHAT = '-1001111111111';
const TEST_CHAT = '-1002222222222';

let fake: { url: string; close: () => Promise<void> };
let dir: string;

const control = (p: string, body?: unknown) =>
  fetch(`${fake.url}/_control/${p}`, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
const calls = async () => ((await (await control('calls')).json()) as { calls: { chat_id: string; text: string; tokenMatches: boolean }[] }).calls;

function envFile(content: string): string {
  const p = path.join(dir, `secrets-${Math.random().toString(36).slice(2)}.env`);
  fs.writeFileSync(p, content);
  return p;
}
const good = () => envFile(`# panel\nTELEGRAM_BOT_TOKEN="${TOKEN}"\r\nTELEGRAM_CHAT_ID=${OWNER_CHAT}\nTELEGRAM_TEST_CHAT_ID=${TEST_CHAT}\n`);

beforeAll(async () => {
  fake = await startFakeTelegram({ port: 0, token: TOKEN });
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 't2f-tg-cli-'));
});
afterAll(async () => {
  await fake.close();
  fs.rmSync(dir, { recursive: true, force: true });
});
beforeEach(async () => {
  await control('reset', {});
});

describe('ops:telegram-test', () => {
  it('defaults: the real Telegram API and dashboard/secrets/.env of the project root', () => {
    expect(TELEGRAM_API_BASE).toBe('https://api.telegram.org');
    expect(DEFAULT_SECRETS_ENV.replace(/\\/g, '/')).toMatch(/\/dashboard\/secrets\/\.env$/);
    expect(DEFAULT_SECRETS_ENV.replace(/\\/g, '/')).not.toMatch(/\/web\/dashboard\//);
  });

  it('sends exactly one message, only to the test chat, and prints «надіслано»', async () => {
    const r = await runTelegramTest({ envPath: good(), apiBase: fake.url });
    expect(r).toEqual({ ok: true, line: 'надіслано' });
    const c = await calls();
    expect(c).toHaveLength(1);
    expect(c[0]?.chat_id).toBe(TEST_CHAT);
    expect(c[0]?.tokenMatches).toBe(true);
    expect(c[0]?.text).toContain('тест каналу тривог');
  });

  it('failure prints only «помилка <status>», never a secret', async () => {
    await control('mode', { mode: 'forbidden' });
    const r = await runTelegramTest({ envPath: good(), apiBase: fake.url });
    expect(r).toEqual({ ok: false, line: 'помилка 403' });
    for (const secret of [TOKEN, TEST_CHAT, OWNER_CHAT]) expect(r.line).not.toContain(secret);
  });

  it('missing file / missing or bad variables → error code by name, no request', async () => {
    expect(await runTelegramTest({ envPath: path.join(dir, 'nope.env'), apiBase: fake.url })).toEqual({ ok: false, line: 'помилка no-secrets-file' });
    expect(await runTelegramTest({ envPath: envFile(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`), answersPath: path.join(dir, 'nope.json'), apiBase: fake.url })).toEqual({
      ok: false,
      line: 'помилка missing TELEGRAM_TEST_CHAT_ID',
    });
    expect(await runTelegramTest({ envPath: envFile(`TELEGRAM_BOT_TOKEN=${TOKEN}\nTELEGRAM_TEST_CHAT_ID=not a chat\n`), apiBase: fake.url })).toEqual({
      ok: false,
      line: 'помилка invalid TELEGRAM_TEST_CHAT_ID',
    });
    expect(await calls()).toHaveLength(0);
  });

  it('test chat id falls back to the panel answers (own-telegram field) when .env has none', async () => {
    const answers = path.join(dir, 'answers.json');
    fs.writeFileSync(answers, JSON.stringify({ fields: { 'own-telegram': { telegram_test_chat_id: { value: ` ${TEST_CHAT} ` } } } }));
    const r = await runTelegramTest({ envPath: envFile(`TELEGRAM_BOT_TOKEN=${TOKEN}\n`), answersPath: answers, apiBase: fake.url });
    expect(r).toEqual({ ok: true, line: 'надіслано' });
    const c = await calls();
    expect(c).toHaveLength(1);
    expect(c[0]?.chat_id).toBe(TEST_CHAT);
    expect(testChatFromAnswers('not json')).toBeUndefined();
  });

  it('parseEnvFile: quotes, export, comments, CRLF', () => {
    expect(parseEnvFile("# c\nexport A='1'\r\nB = \"two\"\n\nC=3")).toEqual({ A: '1', B: 'two', C: '3' });
  });
});
