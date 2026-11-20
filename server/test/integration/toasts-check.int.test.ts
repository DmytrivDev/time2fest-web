/**
 * SPEC-09 W28: `POST /api/toasts/check` through the dispatcher (edge gate active, so each client has a
 * daily fingerprint), against the fake AI (in this process on port 0), this worktree's Postgres and
 * Redis. AC-35 … AC-39, AC-46, NFR-2. AC-36 is also the toasts contract-conformance evidence: every
 * rule issue equals `checkToastText` of the package — the value `lib/api/sim/toasts.ts` returns.
 */
import { randomBytes } from 'node:crypto';
import { checkToastText } from '@time2fest/rules/text';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeAi } from '../../../fakes/ai/server.mjs';
import { buildDispatcher } from '../../src/container';
import { moderationOf } from '../../src/endpoints/deps';
import type { ModerationDeps } from '../../src/endpoints/types';
import { ownRedis, post, testDeps } from './helpers';

type Dispatch = (req: Request) => Promise<Response>;
const KEY = 'fake-key-for-tests'; // check-secrets: allow test fake
// Built at runtime: no secret-looking literal in the test.
const EDGE_SECRET = randomBytes(20).toString('hex');
const RL_PREFIX = 'rl:toasts-check:';
const redis = ownRedis();
let url = '';
let close: () => Promise<void>;
let dispatch: Dispatch;
let m: ModerationDeps;
const lines: Record<string, unknown>[] = [];
const push = (l: Record<string, unknown>) => void lines.push(l);

let ipSeq = 0;
/** A fresh client address (own rate-limit bucket) from TEST-NET-2. */
const nextIp = () => `198.51.100.${(ipSeq++ % 250) + 1}`;
const check = (body: unknown, ip: string) =>
  dispatch(post('/api/toasts/check', body, { 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': `${ip};UA` }));
const checkRaw = (raw: string, ip: string) =>
  dispatch(
    new Request('http://127.0.0.1:3000/api/toasts/check', {
      method: 'POST',
      body: raw,
      headers: { 'content-type': 'application/json', origin: 'http://allowed.test', 'x-t2f-edge': EDGE_SECRET, 'x-t2f-client': `${ip};UA` },
    }),
  );
const control = (provider: 'anthropic' | 'deepseek', knobs: unknown) =>
  fetch(`${url}/_control/${provider}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(knobs) });
const requestCount = async () => ((await (await fetch(`${url}/_control/requests`)).json()) as unknown[]).length;
const errorOf = async (res: Response) => ((await res.json()) as { error: { code: string; reason?: string } }).error;

beforeAll(async () => {
  ({ url, close } = await startFakeAi({ port: 0 }));
  await redis.deleteByPrefix(RL_PREFIX);
  const deps = testDeps(
    { redis, log: { info: push, warn: push, error: push } },
    { T2F_EDGE_SECRET: EDGE_SECRET, T2F_AI_ANTHROPIC_URL: url, T2F_AI_DEEPSEEK_URL: url, ANTHROPIC_API_KEY: KEY, DEEPSEEK_API_KEY: KEY },
  );
  m = moderationOf(deps);
  dispatch = await buildDispatcher(deps);
});
afterAll(async () => {
  await redis.deleteByPrefix(RL_PREFIX);
  await redis.close();
  await close();
});
beforeEach(async () => {
  await fetch(`${url}/_control/reset`, { method: 'POST' });
  m.spend.reset();
  m.layer.reset();
});

describe('SPEC-09 POST /api/toasts/check', () => {
  it('AC-35: empty, only spaces, 121 characters, an extra field, over 2 KiB → 400 invalid-input', async () => {
    const ip = nextIp();
    for (const body of [{ text: '' }, { text: '   ' }, { text: 'a'.repeat(121) }, { text: 'hi', extra: 1 }]) {
      const res = await check(body, ip);
      expect(res.status, JSON.stringify(body)).toBe(400);
      expect(await errorOf(res)).toMatchObject({ code: 'validation', reason: 'invalid-input' });
    }
    const big = await checkRaw(JSON.stringify({ text: 'hi', pad: 'x'.repeat(2_100) }), nextIp());
    expect(big.status).toBe(400);
    expect(await errorOf(big)).toMatchObject({ code: 'validation', reason: 'invalid-input' });
    expect(await requestCount()).toBe(0);
  });

  it('AC-36: every rule issue is 200 {issue} equal to checkToastText of the package, with no AI call', async () => {
    const examples = [
      'Пишіть мені: t.me/olena_ny 🎉',
      'дивіться www.spam.com зараз',
      'пишіть olena@example.com',
      'дзвоніть +380 67 123 45 67',
      'шукайте @olena_ny',
      'Ну ти й сука, Новий рік!',
    ];
    const ip = nextIp();
    for (const text of examples) {
      const res = await check({ text }, ip);
      expect(res.status, text).toBe(200);
      const expected = checkToastText(text);
      expect(expected, text).not.toBeNull();
      expect(await res.json()).toEqual({ ok: true, value: { issue: expected } });
    }
    expect(await requestCount()).toBe(0);
  });

  it('AC-37: provider score 0.6 (review) → 400 validation moderation; score 0.1 → {issue: null}', async () => {
    const ip = nextIp();
    await control('anthropic', { score: 0.6 });
    const res = await check({ text: 'Happy 2027, world' }, ip);
    expect(res.status).toBe(400);
    expect(await errorOf(res)).toMatchObject({ code: 'validation', reason: 'moderation' });
    await control('anthropic', { score: 0.1 });
    expect(await (await check({ text: 'Happy 2027, world' }, ip)).json()).toEqual({ ok: true, value: { issue: null } });
  });

  it('AC-38: moderation in fallback → the fallback filter: extended word → moderation, clean → {issue: null}, no AI call', async () => {
    const ip = nextIp();
    await control('anthropic', { down: 503 });
    await control('deepseek', { down: 503 });
    for (let i = 0; i < 3; i++) await check({ text: 'Happy 2027' }, ip);
    expect(m.layer.state('moderation').state).toBe('fallback');
    const before = await requestCount();
    const blocked = await check({ text: 'happy zqxfallbackctl7 year' }, ip);
    expect(blocked.status).toBe(400);
    expect(await errorOf(blocked)).toMatchObject({ code: 'validation', reason: 'moderation' });
    expect(await (await check({ text: 'Happy 2027, world' }, ip)).json()).toEqual({ ok: true, value: { issue: null } });
    expect(await requestCount()).toBe(before);
  });

  it('AC-39: the 21st request of one client within 60 s → 429 rate_limited, the fake got ≤ 20 requests', async () => {
    const ip = nextIp();
    for (let i = 0; i < 20; i++) expect((await check({ text: `Happy 2027 #${i}` }, ip)).status).toBe(200);
    const res = await check({ text: 'Happy 2027 #20' }, ip);
    expect(res.status).toBe(429);
    expect((await errorOf(res)).code).toBe('rate_limited');
    expect(await requestCount()).toBeLessThanOrEqual(20);
  });

  it('AC-46: log lines carry neither the toast text nor the client address', async () => {
    lines.length = 0;
    const ip = '198.51.100.251';
    const text = 'Unique toast text 7f3a9c';
    await check({ text }, ip);
    await control('anthropic', { down: 503 });
    await check({ text }, ip);
    expect(lines.length).toBeGreaterThan(0);
    const all = JSON.stringify(lines);
    expect(all).not.toContain(text);
    expect(all).not.toContain(ip);
    expect(lines.some((l) => l.event === 'ai-call')).toBe(true);
  });

  it('NFR-2: 200 sequential checks with the primary at 300 ms → p95 ≤ 2 s', { timeout: 180_000 }, async () => {
    await control('anthropic', { delayMs: 300, score: 0.1 });
    const ms: number[] = [];
    let ip = nextIp();
    for (let i = 0; i < 200; i++) {
      if (i % 20 === 0) ip = nextIp();
      const t = performance.now();
      const res = await check({ text: `Happy New Year ${i}` }, ip);
      ms.push(performance.now() - t);
      expect(res.status).toBe(200);
    }
    ms.sort((a, b) => a - b);
    const p95 = ms[Math.ceil(ms.length * 0.95) - 1]!;
    console.log(`NFR-2 toasts.check p95 = ${Math.round(p95)} ms over 200 requests (primary 300 ms)`);
    expect(p95).toBeLessThanOrEqual(2_000);
  });
});

describe('SPEC-09 security round 3: toasts.check (S6, S4)', () => {
  it('S6: 10 checks of text with a lone surrogate → 400 invalid-input from the body schema, no AI request', async () => {
    const ip = nextIp();
    for (let i = 0; i < 10; i++) {
      const res = await check({ text: 'a\uD800' }, ip);
      expect(res.status).toBe(400);
      expect(await errorOf(res)).toMatchObject({ code: 'validation', reason: 'invalid-input' });
    }
    expect(await requestCount()).toBe(0);
    expect(m.layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
  });

  it('S4: toasts sub-budget spent → the check uses only the fallback filter, chat verdicts still reach the primary', async () => {
    // 20 % of the default $100 month ceiling.
    await m.spend.setSpendForDoor('month', 20, 'toasts');
    try {
      expect(m.spend.toastsReached()).toBe(true);
      expect(m.spend.reached()).toBe(false);
      const ok = await check({ text: 'З Новим роком!' }, nextIp());
      expect(ok.status).toBe(200);
      expect(await ok.json()).toMatchObject({ ok: true, value: { issue: null } });
      expect(await requestCount()).toBe(0);
      expect(await m.verdict.verdict({ kind: 'toast', text: 'З Новим роком!', budget: 'toasts' })).toEqual({ outcome: 'allow', source: 'fallback' });
      expect(await requestCount()).toBe(0);
      expect(await m.verdict.verdict({ kind: 'message', text: 'hello' })).toEqual({ outcome: 'allow', source: 'primary' });
      expect(await requestCount()).toBe(1);
    } finally {
      await m.spend.setSpendForDoor('month', 0, 'toasts');
    }
  });

  it('S4: a toast check spends the shared ceiling and the toasts sub-budget', async () => {
    const before = m.spend.totals().month.usd;
    const res = await check({ text: 'З Новим роком!' }, nextIp());
    expect(res.status).toBe(200);
    expect(await requestCount()).toBe(1);
    expect(m.spend.totals().month.usd).toBeGreaterThan(before);
  });
});

describe('SPEC-09 security re-check: toasts.check (N1, N2)', () => {
  it('N1: toasts share 5 a minute (RPM 25) — 50 toasts send 5 and fall back; a message right after still reaches the primary', async () => {
    const deps = testDeps(
      { redis, log: { info: push, warn: push, error: push } },
      {
        T2F_EDGE_SECRET: EDGE_SECRET,
        T2F_AI_ANTHROPIC_URL: url,
        T2F_AI_DEEPSEEK_URL: url,
        ANTHROPIC_API_KEY: KEY,
        DEEPSEEK_API_KEY: KEY,
        T2F_AI_ANTHROPIC_RPM: '25',
        T2F_AI_DEEPSEEK_RPM: '25',
      },
    );
    const own = moderationOf(deps);
    own.layer.reset();
    own.spend.reset();
    const sources: string[] = [];
    for (let i = 0; i < 50; i++) sources.push((await own.verdict.verdict({ kind: 'toast', text: 'З Новим роком!', budget: 'toasts' })).source);
    expect(sources.slice(0, 5)).toEqual(['primary', 'primary', 'primary', 'primary', 'primary']);
    expect(sources.slice(5).every((s) => s === 'fallback')).toBe(true);
    expect(await requestCount()).toBe(5);
    expect(await own.verdict.verdict({ kind: 'message', text: 'hello' })).toEqual({ outcome: 'allow', source: 'primary' });
    expect(await requestCount()).toBe(6);
    expect(own.layer.state('moderation')).toEqual({ task: 'moderation', state: 'available' });
  });

  it('N2: a toast answered 400 (rejected-request) by both providers still moves the toast sub-budget', async () => {
    await control('anthropic', { down: 400 });
    await control('deepseek', { down: 400 });
    // One micro-dollar short of 20 % of the default $100 month ceiling.
    await m.spend.setSpendForDoor('month', 19.999999, 'toasts');
    try {
      expect(m.spend.toastsReached()).toBe(false);
      expect(await m.verdict.verdict({ kind: 'toast', text: 'З Новим роком!', budget: 'toasts' })).toEqual({ outcome: 'allow', source: 'fallback' });
      expect(await requestCount()).toBe(2);
      expect(m.spend.toastsReached()).toBe(true);
    } finally {
      await m.spend.setSpendForDoor('month', 0, 'toasts');
    }
  });
});
