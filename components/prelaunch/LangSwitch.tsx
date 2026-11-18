'use client';

/**
 * Перемикач мов: кнопка з назвою мови й список мов цієї збірки. Кожна мова — звичайне посилання на ту саму сторінку
 * іншою мовою (`hreflang`), тож працює й без JavaScript у списку підвалу. Вибір запам’ятовується в браузері
 * (`localStorage`, ключ `t2f:lang`) — щоб підказка мови більше не з’являлась.
 */
import { createContext, useContext, useEffect, useId, useRef, useState } from 'react';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import { LOCALE_NAMES, type Locale } from '@/i18n/locales';
import { SITE_LOCALES } from '@/lib/prelaunch/env';
import { localeHref, splitLocalePath } from '@/lib/prelaunch/href';
import s from './site.module.css';

export const LANG_KEY = 't2f:lang';

export function rememberLocale(locale: Locale): void {
  try {
    window.localStorage.setItem(LANG_KEY, locale);
  } catch {
    // приватний режим — вибір просто не запам’ятається
  }
}

/** Та сама сторінка іншими мовами: шлях без мови + адреса кожної мови. */
export const LangPathContext = createContext<string | null>(null);

export function useLocaleLinks(): { locale: Locale; href: string }[] {
  const pathname = usePathname() ?? '/';
  const fixed = useContext(LangPathContext);
  const raw = fixed ?? splitLocalePath(pathname).path;
  const path = raw.endsWith('/') ? raw : `${raw}/`;
  return SITE_LOCALES.map((locale) => ({ locale, href: localeHref(locale, path) }));
}

export function LangSwitch({ locale, className }: { locale: Locale; className?: string }) {
  const t = useTranslations('prelaunch.header');
  const links = useLocaleLinks();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open]);

  return (
    <div className={cn(s.langWrap, className)} ref={wrapRef}>
      <button
        type="button"
        ref={btnRef}
        className={s.langBtn}
        aria-expanded={open}
        aria-controls={id}
        aria-label={t('language', { language: LOCALE_NAMES[locale] })}
        onClick={() => setOpen((v) => !v)}
      >
        <Icon name="globe" size={16} />
        {LOCALE_NAMES[locale]}
        <Icon
          name="chevron-down"
          size={14}
          className={cn(s.langChevron, open && s.langChevronOpen)}
        />
      </button>
      {/* Список завжди в розмітці (посилання для пошуковиків), відкривається плавно. */}
      <div className={cn(s.langPop, open && s.langPopOpen)} id={id} inert={!open}>
        <ul className={s.langList} aria-label={t('languageLabel')}>
          {links.map((l) => (
            <li key={l.locale}>
              <a
                href={l.href}
                hrefLang={l.locale}
                lang={l.locale}
                aria-current={l.locale === locale ? 'true' : undefined}
                className={s.langItem}
                onClick={() => rememberLocale(l.locale)}
              >
                {LOCALE_NAMES[l.locale]}
                {l.locale === locale ? <Icon name="check" size={16} /> : null}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
