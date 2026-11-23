/** SPEC-12 AC-37, AC-38, NFR-3, NFR-5: live env names, the secret flag, the network guard, no key in CI. */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parseLiveConfig } from '../../src/domain/live/config';
import { loadEnv } from '../../src/platform/env';
import { envRegistry } from '../../src/registries/env';

const base = {
  DATABASE_URI: 'postgres://t2f@127.0.0.1:5433/t2f_spec_12_live',
  REDIS_URL: 'redis://127.0.0.1:6380/5',
  T2F_REDIS_PREFIX: 't2f:spec_12_live:',
  PAYLOAD_SECRET: 'payload-secret-value-that-is-32-chars-long', // check-secrets: allow fake payload secret for the env loader unit test
};
const LIVE = ['T2F_LIVE_CONFIG', 'T2F_YOUTUBE_API_KEY', 'T2F_YOUTUBE_BASE_URL'];

describe('live env', () => {
  it('parses in test without any live variable', () => {
    expect(loadEnv({ ...base, T2F_ENV: 'test' }, envRegistry).ok).toBe(true);
  });

  it.each(['test', 'rehearsal', 'production'])('%s: no live variable is ever required', (cls) => {
    const r = loadEnv({ ...base, T2F_ENV: cls }, envRegistry);
    if (!r.ok) for (const n of LIVE) expect(r.failing).not.toContain(n);
  });

  it('exactly one key name, it is a secret, and there is no list or rotation', () => {
    const vars = envRegistry.flatMap((b) => b.vars);
    const keys = vars.filter((v) => /YOUTUBE.*KEY/.test(v.name));
    expect(keys.map((v) => v.name)).toEqual(['T2F_YOUTUBE_API_KEY']);
    expect(keys[0]?.secret).toBe(true);
    expect(vars.filter((v) => /YOUTUBE/.test(v.name) && /KEYS|PREVIOUS|ROTAT|LIST/.test(v.name))).toEqual([]);
  });

  it('T2F_LIVE_CONFIG goes through parseLiveConfig', () => {
    expect(parseLiveConfig('{"batchSize":25}').ok).toBe(true);
    expect(parseLiveConfig('not json').ok).toBe(false);
  });

  it('the test guard refuses a request to the YouTube host', () => {
    expect(() => fetch('https://www.googleapis.com/youtube/v3/videos')).toThrow(/guard/);
  });

  it('CI workflow verify.yml has no YouTube variable', () => {
    const text = readFileSync(new URL('../../../.github/workflows/verify.yml', import.meta.url), 'utf8');
    expect(text).not.toMatch(/YOUTUBE/i);
  });
});
