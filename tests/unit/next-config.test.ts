// Runs in the default jsdom environment: tests/unit/setup.ts touches localStorage (node env would fail there).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Cfg = Record<string, unknown>;

// The integration flavour (test + http) fetches the catalog at config time; here the fetch is replaced (SPEC-04, AC-68).
const fetchCatalogTo = vi.hoisted(() => vi.fn<(dir: string, url: string) => Promise<{ version: string }>>(async () => ({ version: 'v-test' })));
vi.mock('../../lib/data/catalogSource.mjs', async (orig) => ({
  ...(await orig<typeof import('../../lib/data/catalogSource.mjs')>()),
  fetchCatalogTo,
}));

async function load(env: { flavour?: string; mode?: string; nodeEnv: string }): Promise<Cfg> {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ENV', env.flavour ?? '');
  vi.stubEnv('NEXT_PUBLIC_API_MODE', env.mode ?? '');
  vi.stubEnv('NODE_ENV', env.nodeEnv);
  const mod = await import('../../next.config');
  const cfg = mod.default as Cfg | (() => Promise<Cfg>);
  return typeof cfg === 'function' ? cfg() : cfg;
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

  it('test + http fetches the catalog (version inlined, alias to the fetched files); a failed fetch exits 1 with no fallback', async () => {
    const cfg = await load({ flavour: 'test', mode: 'http', nodeEnv: 'production' });
    expect((cfg.env as Record<string, string>).NEXT_PUBLIC_CATALOG_VERSION).toBe('v-test');
    const alias = (cfg.turbopack as { resolveAlias: Record<string, string> }).resolveAlias;
    expect(alias['@/data/schedule.json']).toMatch(/schedule\.json$/);
    expect(alias['@/data/countries.json']).toMatch(/countries\.json$/);

    fetchCatalogTo.mockRejectedValueOnce(new Error('catalog: http://127.0.0.1:4000/api/catalog → ECONNREFUSED'));
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => {
      throw new Error('exit');
    }) as never);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(load({ flavour: 'test', mode: 'http', nodeEnv: 'production' })).rejects.toThrow('exit');
    expect(exit).toHaveBeenCalledWith(1);
    expect(err).toHaveBeenCalledWith(expect.stringContaining('/api/catalog'));
    exit.mockRestore();
    err.mockRestore();
  });

  it('production http without T2F_CATALOG_URL reads data/: no fetch, no catalog alias', async () => {
    fetchCatalogTo.mockClear();
    const cfg = await load({ flavour: '', mode: 'http', nodeEnv: 'production' });
    expect(fetchCatalogTo).not.toHaveBeenCalled();
    const alias = (cfg.turbopack as { resolveAlias: Record<string, string> }).resolveAlias;
    expect(alias['@/data/schedule.json']).toBeUndefined();
  });
});
