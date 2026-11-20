import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { CatalogResponseSchema } from '@time2fest/contracts/schemas';
import { describeIntegrationSplit, splitDomains } from './lib/api/domains';
import { HTTP_DOMAINS } from './lib/api/http/domains';
import { resolveApiMode } from './lib/api/mode';
import { fetchCatalogTo, resolveCatalogSource } from './lib/data/catalogSource.mjs';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * Запобіжник шва (`docs/backend/frontend-seam.md`, §2.3): ефективний режим даних. Тестова й демо-збірка — `sim`, будь-яка
 * інша — `http`; `sim` у робочому збиранні без `NEXT_PUBLIC_ENV=test` — помилка збирання. У робочій `http` імітація
 * вирізається з пакета: входи `simEntry` / `simRuntimeEntry` підміняються порожніми модулями (інтеграційна — нижче).
 */
const TEST_BUILD = (process.env.NEXT_PUBLIC_ENV ?? 'production') === 'test';
const API_MODE = resolveApiMode({
  raw: process.env.NEXT_PUBLIC_API_MODE,
  testBuild: TEST_BUILD,
  productionBuild: process.env.NODE_ENV === 'production',
});

// FR-MIG-01: the integration build (test + http) is mixed. A domain with an http adapter uses it, any other keeps its
// sim adapter, so the sim entries stay in its bundle. Only a production http build cuts sim out.
const INTEGRATION_BUILD = TEST_BUILD && API_MODE === 'http';
const CUT_SIM = API_MODE === 'http' && !TEST_BUILD;
if (INTEGRATION_BUILD && !process.env.T2F_API_SPLIT_PRINTED) {
  // Once per build: the static-export workers inherit the env and skip the line.
  process.env.T2F_API_SPLIT_PRINTED = '1';
  const http: readonly string[] = HTTP_DOMAINS;
  console.log(describeIntegrationSplit(splitDomains({ mode: 'http', testBuild: true, hasHttp: (d) => http.includes(d), hasSim: () => true })));
}

// SPEC-02 (AC-44): only `next dev` of the test build in http mode proxies /api/* to this worktree's server.
// A static export ignores rewrites (output: 'export'); the integration build uses server/scripts/serve-int.mjs.
const DEV_API_PROXY = TEST_BUILD && API_MODE === 'http' && process.env.NODE_ENV !== 'production';

// SPEC-04 (AC-68..70): the catalog source of this build. Runs in Node at build; zod and the fetch never reach the bundle.
const CATALOG_SOURCE = resolveCatalogSource({ testBuild: TEST_BUILD, apiMode: API_MODE, env: process.env });
const CATALOG_DIR = `.t2f-catalog/${process.env.NEXT_DIST_DIR ?? 'default'}`;

const PRELAUNCH_BUILD = process.env.NEXT_PUBLIC_PRELAUNCH === '1';

const nextConfig: NextConfig = {
  // Workspace package ships TS source, so Next must transpile it.
  transpilePackages: ['@time2fest/contracts', '@time2fest/rules'],
  // Мовне дерево (app/[locale]) — файли *.pl.tsx — збирається ЛИШЕ в збірці для домену (pnpm build:prelaunch), і в
  // ній немає нічого іншого: ні ефіру, ні входу, ні оплати, ні кабінету. Демо, тестова й робоча збірки мовного дерева
  // не бачать: Turbopack групує CSS усіх сторінок разом, і нові сторінки переставляли б чанки наявних (перевірено
  // 2026-11-18: зсув заголовка /before і кнопки «Тости»), а демо має лишатись точно таким, як є.
  pageExtensions: PRELAUNCH_BUILD ? ['pl.tsx'] : ['tsx', 'ts', 'jsx', 'js'],
  // Типи перевіряє окремий крок (tsc --noEmit); у збірці для домену не дублюємо.
  ...(PRELAUNCH_BUILD ? { typescript: { ignoreBuildErrors: true } } : {}),
  output: 'export',
  trailingSlash: true,
  images: { unoptimized: true },
  // Кнопка інструментів розробника в кутку перекриває кнопки аркушів на телефоні (e2e на dev-сервері).
  devIndicators: false,
  // Inline the build flavour so test-only code (time machine panel, window.__t2f) is pruned from production bundles.
  env: {
    NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV ?? 'production',
    // Демо для тесту на людях (рішення 2026-11-11): тестова збірка + старт ночі перед Парижем, записи торішніх свят.
    NEXT_PUBLIC_DEMO: process.env.NEXT_PUBLIC_DEMO ?? '',
    // SPEC-07 (AC-58): клас сайту; `rehearsal` — збірка test + http без машини часу (lib/env.ts).
    NEXT_PUBLIC_SITE_CLASS: process.env.NEXT_PUBLIC_SITE_CLASS ?? '',
    // Шов: вбудований літерал режиму (див. вище).
    NEXT_PUBLIC_API_MODE: API_MODE,
    // SPEC-08 (AC-58): літерал завжди — без адреси realtime `import('./realtime')` у lib/api/http/site.ts мертвий і
    // centrifuge не потрапляє в пакет (Next вбудовує лише задані NEXT_PUBLIC_*).
    NEXT_PUBLIC_REALTIME_URL: process.env.NEXT_PUBLIC_REALTIME_URL ?? '',
  },
  ...(API_MODE === 'http'
    ? {
        turbopack: {
          resolveAlias: {
            ...(CUT_SIM
              ? {
                  '@/lib/api/simEntry': './lib/api/http/simEntry.disabled.ts',
                  '@/lib/api/simRuntimeEntry': './lib/api/http/simRuntimeEntry.disabled.tsx',
                }
              : {}),
            // Передстартова збірка: годинник пристрою замість годинника сайту — без коду машини часу й window.__t2f.
            ...(PRELAUNCH_BUILD
              ? {
                  '@/lib/time/TimeProvider': './lib/prelaunch/DeviceTimeProvider.tsx',
                  // Бекенду ще немає: спільні блоки (мапа) не мають звертатися до шва даних.
                  '@/lib/api/hooks/auth': './lib/prelaunch/noApi/auth.ts',
                  '@/lib/api/hooks/passport': './lib/prelaunch/noApi/passport.ts',
                }
              : {}),
            ...(CATALOG_SOURCE === 'data'
              ? {}
              : {
                  '@/data/schedule.json': `./${CATALOG_DIR}/schedule.json`,
                  '@/data/countries.json': `./${CATALOG_DIR}/countries.json`,
                }),
          },
        },
      }
    : {}),
  ...(DEV_API_PROXY
    ? {
        rewrites: async () => [
          {
            source: '/api/:path*',
            destination: `http://127.0.0.1:${process.env.T2F_SERVER_PORT ?? '4000'}/api/:path*`,
          },
        ],
      }
    : {}),
  // Окрема тека збірки (демо — `out-demo`): статичний експорт пише туди, а не в `out`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

// A plain object when the catalog comes from data/; an async config only when this build fetches it from the server.
if (CATALOG_SOURCE === 'data' && API_MODE === 'http') console.log('catalog: data/ (T2F_CATALOG_URL not set)');

async function configWithServerCatalog(url: string): Promise<NextConfig> {
  // Fail closed (AC-68): no fallback to data/ when the server cannot be reached.
  try {
    const { version } = await fetchCatalogTo(CATALOG_DIR, url, CatalogResponseSchema);
    console.log(`catalog: ${new URL(url).origin}/api/catalog (version ${version})`); // N-3: no userinfo, no query
    return withNextIntl({ ...nextConfig, env: { ...nextConfig.env, NEXT_PUBLIC_CATALOG_VERSION: version } });
  } catch (e) {
    console.error(e instanceof Error ? e.message : String(e));
    process.exit(1);
  }
}

export default CATALOG_SOURCE === 'data' ? withNextIntl(nextConfig) : () => configWithServerCatalog(CATALOG_SOURCE.url);
