/** SPEC-09 AC-47, AC-48, NFR-6: AI env block, test-class refusal of real hosts, key masking. */
import { describe, expect, it } from 'vitest';
import { createAnthropicProvider } from '../../src/adapters/aiAnthropic';
import { createDeepseekProvider } from '../../src/adapters/aiDeepseek';
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

  it('AC-48: a loopback fake address passes in test', () => {
    expect(loadEnv({ ...base, T2F_AI_ANTHROPIC_URL: 'http://127.0.0.1:4010' }, envRegistry).ok).toBe(true);
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
