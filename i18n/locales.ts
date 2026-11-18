/**
 * Мови сайту (рішення власника 2026-11-18): англійська — головна (на домені без префікса), далі `/uk/`, `/es/`, `/fr/`.
 * Мовне дерево — `app/[locale]/…`; решта сайту (ефір, вхід, кабінет) поки лише українською.
 */
export const LOCALES = ['en', 'uk', 'es', 'fr'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';

/** Назва мови її ж мовою — у перемикачі й підказці. */
export const LOCALE_NAMES: Record<Locale, string> = {
  en: 'English',
  uk: 'Українська',
  es: 'Español',
  fr: 'Français',
};

/**
 * Готовність текстів: `ready` — вичитано; `draft` — чернетка (англійську вичитує власник); `pending` — перекладу ще
 * немає, сторінки показують англійський текст. У збірку для домену (`build:prelaunch`) мова з `pending` не потрапляє.
 */
export const LOCALE_STATUS: Record<Locale, 'ready' | 'draft' | 'pending'> = {
  en: 'draft',
  uk: 'ready',
  es: 'pending',
  fr: 'pending',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * Мови цієї збірки. Демо й тестова — усі чотири (перемикач видно цілком); збірка для домену — без `pending`.
 * `T2F_PRELAUNCH_LOCALES=en,uk,es,fr` задає перелік явно (перегляд ще не готових мов на тимчасовій адресі).
 */
export function buildLocales(env: { prelaunch: boolean; only?: string | undefined }): Locale[] {
  if (env.only) {
    const picked = env.only
      .split(',')
      .map((x) => x.trim())
      .filter(isLocale);
    if (picked.length) return LOCALES.filter((l) => picked.includes(l));
  }
  if (!env.prelaunch) return [...LOCALES];
  return LOCALES.filter((l) => LOCALE_STATUS[l] !== 'pending');
}
