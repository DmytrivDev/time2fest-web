// Runs in the default jsdom environment: tests/unit/setup.ts touches localStorage (node env would fail there).
import { afterEach, describe, expect, it, vi } from 'vitest';

type Cfg = Record<string, unknown>;

// The integration flavour (test + http) fetches the catalog at config time; here the fetch is replaced (SPEC-04, AC-68).
const fetchCatalogTo = vi.hoisted(() => vi.fn<(dir: string, url: string, schema?: unknown) => Promise<{ version: string }>>(async () => ({ version: 'v-test' })));
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

  it('SPEC-08 (AC-58): NEXT_PUBLIC_REALTIME_URL is always an inlined literal — "" when unset, the address when set', async () => {
    vi.stubEnv('NEXT_PUBLIC_REALTIME_URL', undefined);
    const unset = await load({ nodeEnv: 'production', flavour: '', mode: '' });
    expect(unset.env).toHaveProperty('NEXT_PUBLIC_REALTIME_URL', '');
    vi.stubEnv('NEXT_PUBLIC_REALTIME_URL', 'wss://rt.test/connection/websocket');
    const set = await load({ nodeEnv: 'production', flavour: '', mode: '' });
    expect(set.env).toHaveProperty('NEXT_PUBLIC_REALTIME_URL', 'wss://rt.test/connection/websocket');
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

describe('next.config — three build kinds (FR-MIG-01, B3)', () => {
  afterEach(() => vi.unstubAllEnvs());
  const SIM_ALIASES = ['@/lib/api/simEntry', '@/lib/api/simRuntimeEntry'];
  const aliasOf = (cfg: Cfg) => (cfg.turbopack as { resolveAlias: Record<string, string> } | undefined)?.resolveAlias;

  it('test + sim (plain test and demo build): only the next-intl alias, as before', async () => {
    for (const mode of ['sim', '']) {
      const alias = aliasOf(await load({ flavour: 'test', mode, nodeEnv: 'production' })) ?? {};
      expect(Object.keys(alias), mode).toEqual(Object.keys(alias).filter((k) => k.startsWith('next-intl')));
    }
  });

  it('test + http (integration): sim stays in the bundle, only the catalog files are aliased; the split is printed once', async () => {
    vi.stubEnv('T2F_API_SPLIT_PRINTED', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const cfg = await load({ flavour: 'test', mode: 'http', nodeEnv: 'production' });
    const alias = aliasOf(cfg)!;
    for (const a of SIM_ALIASES) expect(alias[a], a).toBeUndefined();
    expect(alias['@/data/countries.json']).toMatch(/countries\.json$/);
    const lines = log.mock.calls.map(([m]) => String(m)).filter((m) => m.startsWith('[api] integration build'));
    expect(lines).toEqual(['[api] integration build: http = live, auth, profile, passport, catalog, site; sim = notifications, rating, checkout, toasts, chat']);
    await load({ flavour: 'test', mode: 'http', nodeEnv: 'production' });
    expect(log.mock.calls.filter(([m]) => String(m).startsWith('[api] integration build'))).toHaveLength(1);
    log.mockRestore();
  });

  it('test + http passes CatalogResponseSchema to the catalog fetch (S4-03)', async () => {
    fetchCatalogTo.mockClear();
    await load({ flavour: 'test', mode: 'http', nodeEnv: 'production' });
    const schema = fetchCatalogTo.mock.calls[0]?.[2] as { safeParse?: unknown } | undefined;
    expect(typeof schema?.safeParse).toBe('function');
  });

  it('production + http: sim is cut out (both entries replaced by the disabled modules); no split line', async () => {
    vi.stubEnv('T2F_API_SPLIT_PRINTED', '');
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const alias = aliasOf(await load({ flavour: '', mode: 'http', nodeEnv: 'production' }))!;
    expect(alias['@/lib/api/simEntry']).toBe('./lib/api/http/simEntry.disabled.ts');
    expect(alias['@/lib/api/simRuntimeEntry']).toBe('./lib/api/http/simRuntimeEntry.disabled.tsx');
    expect(log.mock.calls.some(([m]) => String(m).startsWith('[api] integration build'))).toBe(false);
    log.mockRestore();
  });

  it('production + sim is still refused', async () => {
    await expect(load({ flavour: '', mode: 'sim', nodeEnv: 'production' })).rejects.toThrow(/Робоча збірка з імітацією заборонена/);
  });
});
