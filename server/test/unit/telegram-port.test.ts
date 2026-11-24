/**
 * SPEC-13b AC-13 … AC-17: the real Telegram adapter against the fake — exact body, each answer mapped to the
 * outcome `delivery.ts` expects, no token or `/bot` URL in logs or results, the network guard, and the
 * `selectTelegramSink` matrix of classes and variables.
 */
import http from 'node:http';
import https from 'node:https';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeTelegram } from '../../../fakes/telegram/server.mjs';
import { createTelegramSink, selectTelegramSink, TELEGRAM_TIMEOUT_MS } from '../../src/adapters/telegram';
import { nextAttemptAt } from '../../src/domain/ops/delivery';
import type { Logger } from '../../src/ports';

const TOKEN = 'test-telegram-token-not-real'; // check-secrets: allow test fake
const CHAT = '-100777';

let fake: { url: string; close: () => Promise<void> };

function captureLog(): Logger & { lines: Record<string, unknown>[] } {
  const lines: Record<string, unknown>[] = [];
  return { lines, info: (f) => lines.push(f), warn: (f) => lines.push(f), error: (f) => lines.push(f) };
}

const control = (path: string, body?: unknown) =>
  fetch(`${fake.url}/_control/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const calls = async () => ((await (await control('calls')).json()) as { calls: Record<string, unknown>[] }).calls;

function expectNoSecret(value: unknown): void {
  const text = JSON.stringify(value);
  expect(text).not.toContain(TOKEN);
  expect(text).not.toContain('/bot');
}

beforeAll(async () => {
  fake = await startFakeTelegram({ port: 0, token: TOKEN });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(async () => {
  await control('reset', {});
});

describe('createTelegramSink against the fake', () => {
  it('sends the exact body: chat_id, text, disable_web_page_preview:true, no parse_mode', async () => {
    const sink = createTelegramSink({ apiBase: `${fake.url}/`, token: TOKEN });
    const out = await sink.deliver({ chatId: CHAT, text: 'Тривога <b>не HTML</b>' });
    expect(out).toEqual({ result: 'ok', status: 200 });
    const got = await calls();
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ chat_id: CHAT, text: 'Тривога <b>не HTML</b>', disable_web_page_preview: true, tokenMatches: true });
    expect(got[0]).not.toHaveProperty('parse_mode');
  });

  it('uses a 10 s timeout by default', () => {
    expect(TELEGRAM_TIMEOUT_MS).toBe(10_000);
  });

  it.each([
    ['chat-not-found', { result: 'fatal', status: 400 }],
    ['forbidden', { result: 'fatal', status: 403 }],
    ['error', { result: 'retry', status: 502 }],
  ] as const)('mode %s → %j', async (mode, expected) => {
    await control('mode', { mode });
    const log = captureLog();
    const out = await createTelegramSink({ apiBase: fake.url, token: TOKEN, log }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual(expected);
    expect(log.lines).toEqual([{ event: 'ops/telegram-send-failed', ...expected }]);
    expectNoSecret(log.lines);
  });

  it('429 → retry with retry_after; capped at 300 s', async () => {
    const sink = createTelegramSink({ apiBase: fake.url, token: TOKEN });
    await control('mode', { mode: 'rate-limit', retryAfter: 42 });
    expect(await sink.deliver({ chatId: CHAT, text: 'x' })).toEqual({ result: 'retry', retryAfterSec: 42, status: 429 });
    await control('mode', { mode: 'rate-limit', retryAfter: 9999 });
    expect(await sink.deliver({ chatId: CHAT, text: 'x' })).toEqual({ result: 'retry', retryAfterSec: 300, status: 429 });
  });

  it('a wrong token → fatal 401', async () => {
    const out = await createTelegramSink({ apiBase: fake.url, token: 'other-token' }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual({ result: 'fatal', status: 401 });
  });

  it('outcomes feed delivery.ts: 429 waits retry_after, 400 is fatal', async () => {
    const sink = createTelegramSink({ apiBase: fake.url, token: TOKEN });
    await control('mode', { mode: 'rate-limit', retryAfter: 30 });
    const limited = await sink.deliver({ chatId: CHAT, text: 'x' });
    expect(nextAttemptAt({ raisedAt: 0, attempts: 1, outcome: limited, now: 1_000 })).toEqual({ kind: 'retry', at: 31_000 });
    await control('mode', { mode: 'chat-not-found' });
    const bad = await sink.deliver({ chatId: CHAT, text: 'x' });
    expect(nextAttemptAt({ raisedAt: 0, attempts: 1, outcome: bad, now: 1_000 })).toEqual({ kind: 'failed', reason: 'fatal' });
  });

  it('network failure (fake down) → retry; never throws; no token or /bot URL in log or result', async () => {
    await control('down', { on: true });
    const log = captureLog();
    const out = await createTelegramSink({ apiBase: fake.url, token: TOKEN, log }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual({ result: 'retry' });
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ event: 'ops/telegram-send-failed', result: 'retry' });
    expectNoSecret([out, log.lines]);
  });

  it('a throwing fetch whose error carries the URL → retry; the error text never leaks', async () => {
    const log = captureLog();
    const leaky: typeof fetch = async (input) => {
      throw new Error(`connect failed for ${String(input)}`);
    };
    const out = await createTelegramSink({ apiBase: 'https://api.example.test', token: TOKEN, fetch: leaky, log }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual({ result: 'retry' });
    expect(log.lines).toEqual([{ event: 'ops/telegram-send-failed', result: 'retry', cause: 'Error' }]);
    expectNoSecret([out, log.lines]);
  });

  it('a timeout → retry', async () => {
    const hanging: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      });
    const log = captureLog();
    const out = await createTelegramSink({ apiBase: fake.url, token: TOKEN, fetch: hanging, timeoutMs: 20, log }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual({ result: 'retry' });
    expect(log.lines[0]).toMatchObject({ cause: 'TimeoutError' });
  });
});

describe('network guard (AC-17)', () => {
  it('fetch to api.telegram.org throws inside a test', () => {
    expect(() => fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`)).toThrow(/Telegram hosts are forbidden/);
  });

  it('node:http(s) request and get to telegram.org throw', () => {
    expect(() => https.request('https://api.telegram.org/')).toThrow(/forbidden/);
    expect(() => https.get({ hostname: 'api.telegram.org', path: '/' })).toThrow(/forbidden/);
    expect(() => http.request({ host: 'telegram.org:80' })).toThrow(/forbidden/);
  });

  it('the real adapter pointed at api.telegram.org never reaches it (retry, no leak)', async () => {
    const log = captureLog();
    const out = await createTelegramSink({ apiBase: 'https://api.telegram.org', token: TOKEN, log }).deliver({ chatId: CHAT, text: 'x' });
    expect(out).toEqual({ result: 'retry' });
    expectNoSecret([out, log.lines]);
  });
});

describe('selectTelegramSink (AC-13, AC-14)', () => {
  const full = (base?: string) => ({
    T2F_TELEGRAM_BOT_TOKEN: TOKEN,
    T2F_TELEGRAM_CHAT_ID: '-1001',
    T2F_TELEGRAM_TEST_CHAT_ID: '-1002',
    ...(base === undefined ? {} : { T2F_TELEGRAM_API_BASE: base }),
  });

  it('test + loopback fake → sink to the test chat, owner chat ignored with one warning', async () => {
    const log = captureLog();
    const sel = selectTelegramSink('test', full(fake.url), { log });
    expect(sel.sink).not.toBeNull();
    if (sel.sink === null) return;
    expect(sel).toMatchObject({ chatId: '-1002' });
    expect(log.lines).toEqual([{ event: 'ops/telegram-owner-chat-ignored', class: 'test', variable: 'T2F_TELEGRAM_CHAT_ID' }]);
    expect(await sel.sink.deliver({ chatId: sel.chatId, text: 'x' })).toEqual({ result: 'ok', status: 200 });
    expect((await calls())[0]).toMatchObject({ chat_id: '-1002' });
  });

  it('test + api.telegram.org or no base → off, one not-configured line', () => {
    for (const base of ['https://api.telegram.org', undefined]) {
      const log = captureLog();
      const sel = selectTelegramSink('test', { T2F_TELEGRAM_BOT_TOKEN: TOKEN, T2F_TELEGRAM_TEST_CHAT_ID: '-1002', ...(base ? { T2F_TELEGRAM_API_BASE: base } : {}) }, { log });
      expect(sel).toMatchObject({ sink: null, disabled: 'non-loopback' });
      expect(log.lines.filter((l) => l.event === 'ops/telegram-not-configured')).toHaveLength(1);
      expectNoSecret(log.lines);
    }
  });

  it('rehearsal → test chat only, owner chat ignored with one warning', () => {
    const log = captureLog();
    const sel = selectTelegramSink('rehearsal', full(), { log });
    expect(sel).toMatchObject({ chatId: '-1002' });
    expect(sel.sink).not.toBeNull();
    expect(log.lines).toHaveLength(1);
    expect(log.lines[0]).toMatchObject({ event: 'ops/telegram-owner-chat-ignored' });
  });

  it('production → owner chat; no warning', () => {
    const log = captureLog();
    const sel = selectTelegramSink('production', full(), { log });
    expect(sel).toMatchObject({ chatId: '-1001' });
    expect(log.lines).toEqual([]);
  });

  it('missing token or chat → off with the variable names, never values', () => {
    const cases = [
      ['production', { T2F_TELEGRAM_CHAT_ID: '-1001' }, ['T2F_TELEGRAM_BOT_TOKEN']],
      ['production', { T2F_TELEGRAM_BOT_TOKEN: TOKEN, T2F_TELEGRAM_TEST_CHAT_ID: '-1002' }, ['T2F_TELEGRAM_CHAT_ID']],
      ['rehearsal', { T2F_TELEGRAM_BOT_TOKEN: TOKEN }, ['T2F_TELEGRAM_TEST_CHAT_ID']],
      ['rehearsal', {}, ['T2F_TELEGRAM_BOT_TOKEN', 'T2F_TELEGRAM_TEST_CHAT_ID']],
    ] as const;
    for (const [cls, env, missing] of cases) {
      const log = captureLog();
      const sel = selectTelegramSink(cls, env, { log });
      expect(sel).toEqual({ sink: null, disabled: 'not-configured', missing });
      const lines = log.lines.filter((l) => l.event === 'ops/telegram-not-configured');
      expect(lines).toEqual([{ event: 'ops/telegram-not-configured', class: cls, reason: 'not-configured', missing: [...missing] }]);
      expectNoSecret(log.lines);
    }
  });

  it('rehearsal / production with a plain-http base → off (insecure-base)', () => {
    const log = captureLog();
    const sel = selectTelegramSink('production', full('http://api.example.test'), { log });
    expect(sel).toMatchObject({ sink: null, disabled: 'insecure-base' });
    expect(log.lines).toHaveLength(1);
  });
});
