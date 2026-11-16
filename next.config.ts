import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';
import { resolveApiMode } from './lib/api/mode';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

/**
 * Запобіжник шва (`docs/backend/frontend-seam.md`, §2.3): ефективний режим даних. Тестова й демо-збірка — `sim`, будь-яка
 * інша — `http`; `sim` у робочому збиранні без `NEXT_PUBLIC_ENV=test` — помилка збирання. У `http` імітація вирізається
 * з пакета: входи `simEntry` / `simRuntimeEntry` підміняються порожніми модулями.
 */
const TEST_BUILD = (process.env.NEXT_PUBLIC_ENV ?? 'production') === 'test';
const API_MODE = resolveApiMode({
  raw: process.env.NEXT_PUBLIC_API_MODE,
  testBuild: TEST_BUILD,
  productionBuild: process.env.NODE_ENV === 'production',
});

// SPEC-02 (AC-44): only `next dev` of the test build in http mode proxies /api/* to this worktree's server.
// A static export ignores rewrites (output: 'export'); the integration build uses server/scripts/serve-int.mjs.
const DEV_API_PROXY = TEST_BUILD && API_MODE === 'http' && process.env.NODE_ENV !== 'production';

const nextConfig: NextConfig = {
  // Workspace package ships TS source, so Next must transpile it.
  transpilePackages: ['@time2fest/contracts', '@time2fest/rules'],
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
    // Шов: вбудований літерал режиму (див. вище).
    NEXT_PUBLIC_API_MODE: API_MODE,
  },
  ...(API_MODE === 'http'
    ? {
        turbopack: {
          resolveAlias: {
            '@/lib/api/simEntry': './lib/api/http/simEntry.disabled.ts',
            '@/lib/api/simRuntimeEntry': './lib/api/http/simRuntimeEntry.disabled.tsx',
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

export default withNextIntl(nextConfig);
