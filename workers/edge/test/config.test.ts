import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

type Env = {
  workers_dev?: boolean;
  preview_urls?: boolean;
  assets?: { directory?: string; html_handling?: string; run_worker_first?: string[] };
  vars?: Record<string, string>;
};

const config = JSON.parse(readFileSync(new URL('../wrangler.json', import.meta.url), 'utf8')) as {
  env: Record<string, Env>;
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
});
