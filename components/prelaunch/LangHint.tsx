'use client';

/**
 * Підказка мови (план передстартового сайту, розділ 5): якщо мова браузера — інша мова сайту, а людина ще не обирала
 * мову сама, внизу з’являється ненав’язлива смужка «Читати українською?». Жодного автоматичного перекидання.
 * Текст — мовою, яку пропонуємо. Закрита чи прийнята підказка більше не показується (`localStorage`).
 */
import { useEffect, useState } from 'react';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { isLocale, type Locale } from '@/i18n/locales';
import { SITE_LOCALES } from '@/lib/prelaunch/env';
import { LANG_KEY, rememberLocale, useLocaleLinks } from './LangSwitch';
import s from './site.module.css';

const HINT: Record<Locale, { text: string; yes: string; close: string }> = {
  en: { text: 'Read this page in English?', yes: 'Switch to English', close: 'Close' },
  uk: { text: 'Читати українською?', yes: 'Перейти', close: 'Закрити' },
  es: { text: '¿Leer en español?', yes: 'Cambiar', close: 'Cerrar' },
  fr: { text: 'Lire en français ?', yes: 'Changer', close: 'Fermer' },
};

/** Перша мова браузера, яку має сайт (`uk-UA` → `uk`). */
export function preferredLocale(
  languages: readonly string[],
  available: readonly Locale[],
): Locale | null {
  for (const tag of languages) {
    const base = tag.toLowerCase().split('-')[0];
    if (isLocale(base) && available.includes(base)) return base;
  }
  return null;
}

export function LangHint({ locale }: { locale: Locale }) {
  const links = useLocaleLinks();
  const [target, setTarget] = useState<Locale | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    let chosen: string | null = null;
    try {
      chosen = window.localStorage.getItem(LANG_KEY);
    } catch {
      // без сховища підказку показуємо щоразу — це безпечно
    }
    if (chosen) return;
    const wanted = preferredLocale(navigator.languages ?? [navigator.language], SITE_LOCALES);
    if (!wanted || wanted === locale) return;
    // Наступні кадри — щоб смужка в’їхала плавно.
    let raf = requestAnimationFrame(() => {
      setTarget(wanted);
      raf = requestAnimationFrame(() => setShown(true));
    });
    return () => cancelAnimationFrame(raf);
  }, [locale]);

  if (!target) return null;
  const href = links.find((l) => l.locale === target)?.href;
  if (!href) return null;
  const copy = HINT[target];
  return (
    <aside className={cn(s.hint, shown && s.hintOn)} lang={target} data-lang-hint={target}>
      <Icon name="globe" size={18} />
      <span className={s.hintText}>{copy.text}</span>
      <a className={s.hintYes} href={href} hrefLang={target} onClick={() => rememberLocale(target)}>
        {copy.yes}
      </a>
      <button
        type="button"
        className={s.hintClose}
        aria-label={copy.close}
        onClick={() => {
          rememberLocale(locale);
          setShown(false);
          window.setTimeout(() => setTarget(null), 250);
        }}
      >
        <Icon name="close" size={16} />
      </button>
    </aside>
  );
}
