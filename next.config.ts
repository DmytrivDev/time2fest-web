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
  env: { NEXT_PUBLIC_ENV: process.env.NEXT_PUBLIC_ENV ?? 'production' },
};

export default withNextIntl(nextConfig);
