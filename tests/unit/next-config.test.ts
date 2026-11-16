// Runs in the default jsdom environment: tests/unit/setup.ts touches localStorage (node env would fail there).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Cfg = Record<string, unknown>;

async function load(env: { flavour?: string; mode?: string; nodeEnv: string }): Promise<Cfg> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ENV', env.flavour ?? '');
  vi.stubEnv('NEXT_PUBLIC_API_MODE', env.mode ?? '');
  vi.stubEnv('NODE_ENV', env.nodeEnv);
  const mod = await import('../../next.config');
  return mod.default as Cfg;
}

describe('next.config dev rewrite (AC-44)', () => {
  afterEach(() => vi.unstubAllEnvs());

  it.each([
    ['test', 'http', true],
    ['test', 'sim', false],
    ['', 'sim', false],
    ['', 'http', false],
  ])('development, NEXT_PUBLIC_ENV=%j, NEXT_PUBLIC_API_MODE=%j -> rewrites function: %s', async (flavour, mode, expected) => {
    const cfg = await load({ flavour, mode, nodeEnv: 'development' });
    expect(typeof cfg.rewrites === 'function').toBe(expected);
  });

  it('test + http in a production build has no rewrites', async () => {
    const cfg = await load({ flavour: 'test', mode: 'http', nodeEnv: 'production' });
    expect(cfg.rewrites).toBeUndefined();
  });

  it('the rewrite proxies /api/* to this worktree server port', async () => {
    vi.stubEnv('T2F_SERVER_PORT', '4040');
    const cfg = await load({ flavour: 'test', mode: 'http', nodeEnv: 'development' });
    const rules = await (cfg.rewrites as () => Promise<Array<{ source: string; destination: string }>>)();
    expect(rules).toEqual([{ source: '/api/:path*', destination: 'http://127.0.0.1:4040/api/:path*' }]);
  });

  it('a production build without flags keeps the export key set of the default build', async () => {
    const expected = Object.keys(await load({ nodeEnv: 'production', flavour: '', mode: '' })).sort();
    expect(expected).toEqual(expect.arrayContaining(['transpilePackages', 'output', 'trailingSlash', 'images', 'devIndicators', 'env']));
    const again = Object.keys(await load({ nodeEnv: 'production', flavour: '', mode: 'http' })).sort();
    expect(again).toEqual(expected);
    expect(expected).not.toContain('rewrites');
  });
});
