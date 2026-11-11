import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./i18n/request.ts');

const nextConfig: NextConfig = {
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
  },
  // Окрема тека збірки (демо — `out-demo`): статичний експорт пише туди, а не в `out`.
  ...(process.env.NEXT_DIST_DIR ? { distDir: process.env.NEXT_DIST_DIR } : {}),
};

export default withNextIntl(nextConfig);
