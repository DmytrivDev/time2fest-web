'use client';

/**
 * Шапка мовного дерева (на основі `PrefestHeader`): логотип, навігація, перемикач мов; на телефоні — «Меню».
 * Без входу, реєстрації, тостів-кнопки, паса-кнопки й дзвоника. На головній лежить поверх банера (`overlay`).
 */
import { useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { Logo } from '@/components/primitives/Logo';
import { cn } from '@/components/primitives/cn';
import h from '@/components/prefest/PrefestHeader.module.css';
import p from '@/components/prefest/prefest.module.css';
import { LOCALE_NAMES, type Locale } from '@/i18n/locales';
import { isPageEnabled, localeHref, PAGES, type PageKey } from '@/lib/prelaunch/href';
import { LangSwitch, rememberLocale, useLocaleLinks } from './LangSwitch';
import s from './site.module.css';

/** Пункти шапки — лише увімкнені сторінки (`lib/prelaunch/pages.mjs`); «Про проєкт» прибрано (рішення власника 2026-11-18). */
const NAV: readonly PageKey[] = (['home', 'countries', 'toasts', 'pass'] as const).filter(
  isPageEnabled,
);

export function SiteHeader({
  locale,
  current,
  overlay = false,
}: {
  locale: Locale;
  current?: PageKey | undefined;
  overlay?: boolean;
}) {
  const t = useTranslations('prelaunch.header');
  const links = useLocaleLinks();
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

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

  const home = localeHref(locale, PAGES.home);
  return (
    <header className={cn(overlay ? h.hd : s.hdStatic)}>
      <div className={cn(p.wrap, h.inner)}>
        <Logo href={home} label={t('logoLabel')} className={h.logo} />
        <nav aria-label={t('navLabel')} className={cn(h.nav, s.nav)}>
          {NAV.map((key) => (
            <NextLink
              key={key}
              href={localeHref(locale, PAGES[key])}
              aria-current={current === key ? 'page' : undefined}
            >
              {t(key)}
            </NextLink>
          ))}
        </nav>
        <LangSwitch locale={locale} className={s.langDesktop} />
        <div className={cn(h.menuWrap, s.menuWrap)} ref={wrapRef}>
          <button
            type="button"
            ref={btnRef}
            className={cn(h.menuBtn, s.menuBtn)}
            aria-expanded={open}
            aria-controls="site-menu"
            aria-label={open ? t('menuClose') : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'close' : 'menu'} size={18} />
            {t('menu')}
          </button>
          {/* Шторка меню завжди в розмітці й відкривається плавно. */}
          <div className={cn(s.menuPop, open && s.menuPopOpen)} id="site-menu" inert={!open}>
            <nav className={cn(h.sheet, s.menuSheet)} aria-label={t('menuLabel')}>
              {NAV.map((key) => (
                <NextLink
                  key={key}
                  className={h.menuItem}
                  href={localeHref(locale, PAGES[key])}
                  aria-current={current === key ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                >
                  {t(key)}
                </NextLink>
              ))}
              <span className={h.sep} aria-hidden="true" />
              <span className={s.menuLangTitle}>
                <Icon name="globe" size={16} />
                {t('languageLabel')}
              </span>
              {links.map((l) => (
                <a
                  key={l.locale}
                  className={h.menuItem}
                  href={l.href}
                  hrefLang={l.locale}
                  lang={l.locale}
                  aria-current={l.locale === locale ? 'true' : undefined}
                  onClick={() => rememberLocale(l.locale)}
                >
                  {LOCALE_NAMES[l.locale]}
                </a>
              ))}
            </nav>
          </div>
        </div>
      </div>
    </header>
  );
}
