import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Env = {
  workers_dev?: boolean;
  preview_urls?: boolean;
  assets?: { directory?: string; html_handling?: string; run_worker_first?: string[] };
  vars?: Record<string, string>;
  r2_buckets?: { binding?: string; bucket_name?: string }[];
} & Record<string, unknown>;

const config = JSON.parse(readFileSync(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
  env: Record<string, Env>;
} & Record<string, unknown>;
/** The R2 bucket of each environment (docs/services/cloudflare.md, 2026-11-16); prelaunch has none. */
const BUCKETS: Record<string, string> = {
  test: 'time2fest-test',
  rehearsal: 'time2fest-rehearsal',
  production: 'time2fest-prod',
};
const NAMES = ['test', 'rehearsal', 'prelaunch', 'production'] as const;

describe('wrangler.json', () => {
  it('declares exactly the four environments', () => {
    expect(Object.keys(config.env).sort()).toEqual([...NAMES].sort());
  });

  for (const name of NAMES) {
    it(`${name}: assets, worker-first API paths, no workers.dev bypass`, () => {
      const env = config.env[name]!;
      expect(env.assets?.directory).toBeTruthy();
      expect(env.assets?.run_worker_first).toEqual(['/api', '/api/*']);
      expect(env.assets?.html_handling).toBe('force-trailing-slash');
      expect(env.workers_dev).toBe(false);
      expect(env.preview_urls).toBe(false);
    });
  }

  it('prelaunch has no ORIGIN_URL and its own assets directory', () => {
    expect(config.env.prelaunch!.vars).not.toHaveProperty('ORIGIN_URL');
    const others = NAMES.filter((n) => n !== 'prelaunch').map((n) => config.env[n]!.assets?.directory);
    expect(others).not.toContain(config.env.prelaunch!.assets?.directory);
  });

  it('holds no secret-looking var', () => {
    for (const name of NAMES) {
      for (const key of Object.keys(config.env[name]!.vars ?? {})) {
        expect(key).not.toMatch(/secret|token|key|password/i);
      }
    }
  });

  it('AC-32: no `cache` key at the top level or in any env', () => {
    expect(config).not.toHaveProperty('cache');
    for (const name of NAMES) expect(config.env[name], name).not.toHaveProperty('cache');
  });

  it('SITE_BUCKET: only per env, with its own bucket and an R2_PREFIX; never in prelaunch', () => {
    expect(config).not.toHaveProperty('r2_buckets');
    expect(config.env.prelaunch!.r2_buckets ?? []).toEqual([]);
    expect(config.env.prelaunch!.vars).not.toHaveProperty('R2_PREFIX');
    for (const name of NAMES) {
      const site = (config.env[name]!.r2_buckets ?? []).filter((b) => b.binding === 'SITE_BUCKET');
      expect(site.length, name).toBeLessThanOrEqual(1);
      if (site.length === 0) continue;
      expect(site[0]!.bucket_name, name).toBe(BUCKETS[name]);
      expect(config.env[name]!.vars?.R2_PREFIX, name).toMatch(/^[a-z0-9_]+\/$/);
    }
  });
});
