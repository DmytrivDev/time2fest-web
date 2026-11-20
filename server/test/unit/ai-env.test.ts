/** SPEC-09 AC-47, AC-48, NFR-6: AI env block, test-class refusal of real hosts, key masking. */
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicProvider } from '../../src/adapters/aiAnthropic';
import { createDeepseekProvider } from '../../src/adapters/aiDeepseek';
import { createProviderLayer, perProcessRpm } from '../../src/moderation/providers';
import type { AiProvider } from '../../src/moderation/ports';
import { loadEnv } from '../../src/platform/env';
import { createLogger } from '../../src/platform/logger';
import { envRegistry } from '../../src/registries/env';

const base = {
  T2F_ENV: 'test',
  DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_09_moderation',
  REDIS_URL: 'redis://127.0.0.1:6380/5',
  T2F_REDIS_PREFIX: 't2f:spec_09_moderation:',
  PAYLOAD_SECRET: 'payload-secret-value-that-is-32-chars-long', // check-secrets: allow fake payload secret for the env loader unit test
};

describe('AI env', () => {
  it('AC-47: boots without keys and applies the defaults', () => {
    const r = loadEnv(base, envRegistry);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(r.env.T2F_AI_ANTHROPIC_MODEL).toBe('claude-haiku-5-5');
    expect(r.env.T2F_AI_DEEPSEEK_MODEL).toBe('deepseek-flash');
    expect(r.env.T2F_AI_ANTHROPIC_VERSION).toBe('2026-10-21');
    expect(r.env.T2F_AI_DEEPSEEK_PRICE_CACHE_MISS).toBe('0.30');
  });

  it.each([
    ['T2F_AI_ANTHROPIC_URL', 'https://api.anthropic.com'],
    ['T2F_AI_ANTHROPIC_URL', 'https://API.Anthropic.com./'],
    ['T2F_AI_DEEPSEEK_URL', 'https://api.deepseek.com/v1'],
  ])('AC-48: test class refuses %s = %s', (name, value) => {
    const r = loadEnv({ ...base, [name]: value }, envRegistry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing).toEqual([name]);
  });

  it.each(['http://127.0.0.1:4010', 'http://localhost:4010', 'http://[::1]:4010'])('AC-48: a loopback fake address %s passes in test', (url) => {
    expect(loadEnv({ ...base, T2F_AI_ANTHROPIC_URL: url, T2F_AI_DEEPSEEK_URL: url }, envRegistry).ok).toBe(true);
  });

  it.each([
    ['T2F_AI_ANTHROPIC_URL', 'https://ai-proxy.example.com'],
    ['T2F_AI_DEEPSEEK_URL', 'http://10.0.0.5:4010'],
  ])('S8: test class refuses a non-loopback %s = %s', (name, value) => {
    const r = loadEnv({ ...base, [name]: value }, envRegistry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing).toEqual([name]);
  });

  it.each([
    ['T2F_AI_ANTHROPIC_URL', 'http://api.anthropic.com'],
    ['T2F_AI_DEEPSEEK_URL', 'http://127.0.0.1:4010'],
  ])('S8: outside test %s = %s (not https) is refused', (name, value) => {
    const r = loadEnv({ ...base, T2F_ENV: 'rehearsal', [name]: value }, envRegistry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing).toContain(name);
  });

  it('S8: outside test an https provider address passes the AI check', () => {
    const r = loadEnv({ ...base, T2F_ENV: 'rehearsal', T2F_AI_ANTHROPIC_URL: 'https://api.anthropic.com' }, envRegistry);
    if (!r.ok) expect(r.failing).not.toContain('T2F_AI_ANTHROPIC_URL');
  });

  it('S7: RPM is an account budget; T2F_AI_PROCESSES=2 halves the per-process bucket', async () => {
    const one = loadEnv(base, envRegistry);
    const two = loadEnv({ ...base, T2F_AI_PROCESSES: '2' }, envRegistry);
    if (!one.ok || !two.ok) throw new Error('env');
    expect(one.env.T2F_AI_PROCESSES).toBe(1);
    const rpm = (env: Record<string, unknown>, name: string) => perProcessRpm(Number(env[name]), Number(env.T2F_AI_PROCESSES));
    expect(rpm(one.env, 'T2F_AI_ANTHROPIC_RPM')).toBe(3_400);
    expect(rpm(two.env, 'T2F_AI_ANTHROPIC_RPM')).toBe(1_700);
    expect(rpm(two.env, 'T2F_AI_DEEPSEEK_RPM')).toBe(500);
    expect(perProcessRpm(1_000, 3)).toBe(333);
    // The bucket built from it: 1 700 a minute, 80 % for non-toast calls → 1 360 go out, the next is throttled.
    const p: AiProvider = { id: 'anthropic', configured: true, moderate: vi.fn(), translate: vi.fn(), probe: vi.fn() };
    const d: AiProvider = { ...p, id: 'deepseek' };
    const layer = createProviderLayer({
      providers: { moderation: [p, d], translation: [p, d] },
      clock: { now: () => 0 },
      alarm: { raise: () => undefined },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      ratePerMin: { anthropic: rpm(two.env, 'T2F_AI_ANTHROPIC_RPM') },
    });
    const ok = async () => ({ ok: true as const, value: { raw: '{"score":0}' }, ms: 0 });
    let sent = 0;
    for (let i = 0; i < 1_361; i++) if ((await layer.call('moderation', p, ok)).ok) sent++;
    expect(sent).toBe(1_360);
  });

  it.each(['0', '-1', '1.5', 'two'])('S7: T2F_AI_PROCESSES=%s is refused', (value) => {
    const r = loadEnv({ ...base, T2F_AI_PROCESSES: value }, envRegistry);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failing).toEqual(['T2F_AI_PROCESSES']);
  });

  it('NFR-6: the key value is masked in a log line', () => {
    const key = 'sk-ant-fake-key-0123456789'; // check-secrets: allow test fake
    const r = loadEnv({ ...base, ANTHROPIC_API_KEY: key }, envRegistry);
    if (!r.ok) throw new Error('env');
    const lines: string[] = [];
    const log = createLogger(r.secrets, { clock: { now: () => 0 }, write: (l) => void lines.push(l) });
    log.info({ detail: `header x-api-key ${key}` });
    expect(lines.join('')).not.toContain(key);
  });

  it('AC-47: without a key the providers are not configured and answer not-configured', async () => {
    const a = createAnthropicProvider({ url: 'http://127.0.0.1:1', apiKey: undefined, model: 'm', version: 'v' });
    const d = createDeepseekProvider({ url: 'http://127.0.0.1:1', apiKey: undefined, model: 'm' });
    expect(a.configured).toBe(false);
    expect(d.configured).toBe(false);
    expect(await a.moderate('x', undefined, new AbortController().signal)).toEqual({ ok: false, kind: 'not-configured' });
    expect(await d.probe(new AbortController().signal)).toEqual({ ok: false, kind: 'not-configured' });
  });
});
