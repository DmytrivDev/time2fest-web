/**
 * SPEC-13b AC-16: the fake Telegram Bot API — every mode answers as Telegram does, `/_control/*` works,
 * the token never shows in `calls`. Loopback only, port 0.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeTelegram } from '../../../fakes/telegram/server.mjs';

const TOKEN = 'test-telegram-token-not-real'; // check-secrets: allow test fake

let fake: { url: string; close: () => Promise<void> };

const control = (path: string, body?: unknown) =>
  fetch(`${fake.url}/_control/${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

const sendMessage = (body: unknown, token = TOKEN) =>
  fetch(`${fake.url}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const msg = { chat_id: '-100123', text: 'тест', disable_web_page_preview: true };

beforeAll(async () => {
  fake = await startFakeTelegram({ port: 0, token: TOKEN });
});
afterAll(async () => {
  await fake.close();
});
beforeEach(async () => {
  await control('reset', {});
});

describe('fake Telegram', () => {
  it('listens on 127.0.0.1', () => {
    expect(new URL(fake.url).hostname).toBe('127.0.0.1');
  });

  it('ok: 200 with increasing message ids', async () => {
    const a = await sendMessage(msg);
    expect(a.status).toBe(200);
    const ja = (await a.json()) as { ok: boolean; result: { message_id: number } };
    expect(ja.ok).toBe(true);
    const jb = (await (await sendMessage(msg)).json()) as { result: { message_id: number } };
    expect(jb.result.message_id).toBe(ja.result.message_id + 1);
  });

  it('chat-not-found: 400', async () => {
    await control('mode', { mode: 'chat-not-found' });
    const r = await sendMessage(msg);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { description: string }).description).toContain('chat not found');
  });

  it('forbidden: 403', async () => {
    await control('mode', { mode: 'forbidden' });
    expect((await sendMessage(msg)).status).toBe(403);
  });

  it('rate-limit: 429 with parameters.retry_after', async () => {
    await control('mode', { mode: 'rate-limit', retryAfter: 17 });
    const r = await sendMessage(msg);
    expect(r.status).toBe(429);
    expect(((await r.json()) as { parameters: { retry_after: number } }).parameters.retry_after).toBe(17);
  });

  it('error: 502', async () => {
    await control('mode', { mode: 'error' });
    expect((await sendMessage(msg)).status).toBe(502);
  });

  it('down: the connection is destroyed; /_control/down off restores ok', async () => {
    expect((await control('down', { on: true })).status).toBe(200);
    await expect(sendMessage(msg)).rejects.toThrow();
    await control('down', { on: false });
    expect((await sendMessage(msg)).status).toBe(200);
  });

  it('times: the mode lasts that many requests, then ok', async () => {
    await control('mode', { mode: 'error', times: 2 });
    expect((await sendMessage(msg)).status).toBe(502);
    expect((await sendMessage(msg)).status).toBe(502);
    expect((await sendMessage(msg)).status).toBe(200);
  });

  it('a wrong token gets 401', async () => {
    expect((await sendMessage(msg, 'other-token')).status).toBe(401);
  });

  it('refuses an unknown mode and bad control bodies', async () => {
    expect((await control('mode', { mode: 'nope' })).status).toBe(400);
    expect((await control('mode', { mode: 'rate-limit', retryAfter: -1 })).status).toBe(400);
    expect((await control('mode', { mode: 'error', times: 0 })).status).toBe(400);
    expect((await control('down', {})).status).toBe(400);
  });

  it('calls: records every message without the token; reset clears', async () => {
    await sendMessage(msg);
    await control('mode', { mode: 'forbidden' });
    await sendMessage({ ...msg, text: 'друге', parse_mode: 'HTML' });
    const raw = await (await control('calls')).text();
    expect(raw).not.toContain(TOKEN);
    const { calls } = JSON.parse(raw) as { calls: Record<string, unknown>[] };
    expect(calls).toHaveLength(2);
    expect(calls[0]).toMatchObject({ path: '/bot<token>/sendMessage', chat_id: '-100123', text: 'тест', disable_web_page_preview: true, tokenMatches: true });
    expect(calls[0]).not.toHaveProperty('parse_mode');
    expect(calls[1]).toMatchObject({ text: 'друге', parse_mode: 'HTML' });
    expect(typeof calls[0]?.at).toBe('string');
    await control('reset', {});
    expect(((await (await control('calls')).json()) as { calls: unknown[] }).calls).toEqual([]);
    expect((await sendMessage(msg)).status).toBe(200);
  });

  it('unknown paths are 404', async () => {
    expect((await fetch(`${fake.url}/bot${TOKEN}/getMe`, { method: 'POST' })).status).toBe(404);
  });
});
