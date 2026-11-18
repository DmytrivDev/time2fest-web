import { getRequestConfig } from 'next-intl/server';
import { isLocale } from './locales';

/**
 * Без i18n-маршрутизації next-intl: сайт — статичний експорт. Сторінки ефіру, входу й кабінету — лише українською
 * (мову не передають → увесь `uk.json`, як і раніше). Мовне дерево `app/[locale]` передає мову явно
 * (`getTranslations({ locale })`, `NextIntlClientProvider`) і отримує свій набір текстів (`lib/prelaunch/messages`).
 */
export default getRequestConfig(async ({ locale }) => {
  if (isLocale(locale)) {
    const { prelaunchMessages } = await import('../lib/prelaunch/messages');
    return { locale, messages: prelaunchMessages(locale) };
  }
  return { locale: 'uk', messages: (await import('../messages/uk.json')).default };
});
