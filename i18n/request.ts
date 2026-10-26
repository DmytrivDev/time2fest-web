import { getRequestConfig } from 'next-intl/server';

// Одна мова без i18n-маршрутизації (research.md, розділ 1).
export default getRequestConfig(async () => {
  const locale = 'uk';
  return { locale, messages: (await import(`../messages/${locale}.json`)).default };
});
