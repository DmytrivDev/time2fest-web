import { notFound } from 'next/navigation';
import { isLocale, type Locale } from '@/i18n/locales';

export type LocaleParams = Promise<{ locale: string }>;

/** Мова сторінки з параметра маршруту; невідома — 404. */
export async function localeOf(params: LocaleParams): Promise<Locale> {
  const { locale } = await params;
  if (!isLocale(locale)) notFound();
  return locale;
}
