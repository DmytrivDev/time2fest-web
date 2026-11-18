'use client';

/**
 * Шапка мовного дерева — та сама, що на сайті (`components/shell/Header` і його стилі `header.module.css`): лого,
 * «Головна · Країни · Тости» текстом, «Новорічний пас» — окрема золота кнопка праворуч, капсула «Меню». Без входу,
 * дзвоника й «Сказати тост». Перемикач мов — свій (рішення власника 2026-11-18: «вибір мови лишається як зараз»).
 * Закріплена завжди (рішення власника 2026-11-19): на головній при вході прозора поверх банера, з прокручуванням
 * стає залитою; на інших сторінках — залита одразу.
 */
import { useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { cn } from '@/components/primitives/cn';
import h from '@/components/prefest/PrefestHeader.module.css';
import hs from '@/components/shell/header.module.css';
import { LOCALE_NAMES, type Locale } from '@/i18n/locales';
import { isPageEnabled, localeHref, PAGES, type PageKey } from '@/lib/prelaunch/href';
import { LangSwitch, rememberLocale, useLocaleLinks } from './LangSwitch';
import s from './site.module.css';

/** Текстові пункти шапки — лише увімкнені сторінки (`lib/prelaunch/pages.mjs`); пас — окремою кнопкою. */
const NAV: readonly PageKey[] = (['home', 'countries', 'toasts'] as const).filter(isPageEnabled);
/** У меню — усі сторінки, разом із пасом. */
const MENU: readonly PageKey[] = (['home', 'countries', 'toasts', 'pass'] as const).filter(
  isPageEnabled,
);

/** Головна: шапка прозора, поки сторінку не прокрутили. */
function useScrolled(enabled: boolean): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [enabled]);
  return scrolled;
}

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
  const scrolled = useScrolled(overlay);
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
    <div
      className={cn(s.hdDock, overlay && s.hdDockOverlay)}
      data-header-clear={overlay && !scrolled && !open ? '' : undefined}
    >
      <header className={cn(hs.header, s.hd)}>
        <div className={hs.bar}>
          <NextLink
            href={home}
            aria-label={t('logoLabel')}
            className={cn('t2f-focus rounded-sm', hs.logo)}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт, зображення вже потрібного розміру */}
            <img src="/brand/logo.png" alt="" width={150} height={43} />
          </NextLink>
          <nav aria-label={t('navLabel')} className={hs.nav}>
            {NAV.map((key) => (
              <NextLink
                key={key}
                href={localeHref(locale, PAGES[key])}
                aria-current={current === key ? 'page' : undefined}
                className={cn('t2f-focus', hs.navLink)}
              >
                {t(key)}
              </NextLink>
            ))}
          </nav>
          <span className={hs.spacer} />
          <LangSwitch locale={locale} className={s.langDesktop} />
          {isPageEnabled('pass') ? (
            <NextLink
              href={localeHref(locale, PAGES.pass)}
              aria-current={current === 'pass' ? 'page' : undefined}
              aria-label={t('pass')}
              className={cn('t2f-focus', hs.pass)}
            >
              <Icon name="ticket" size={18} />
              <span className={hs.passShort}>{t('passShort')}</span>
              <span className={hs.passFull}>{t('pass')}</span>
            </NextLink>
          ) : null}
          <div className={cn(hs.mine, s.menuWrap)} ref={wrapRef}>
            <button
              type="button"
              ref={btnRef}
              className={cn('t2f-focus', hs.text, hs.menu)}
              aria-expanded={open}
              aria-controls="site-menu"
              aria-label={open ? t('menuClose') : t('menu')}
              onClick={() => setOpen((v) => !v)}
            >
              <Icon name={open ? 'close' : 'menu'} size={20} />
              <span className={hs.label}>{t('menu')}</span>
            </button>
            {/* Шторка меню завжди в розмітці й відкривається плавно. */}
            <div className={cn(s.menuPop, open && s.menuPopOpen)} id="site-menu" inert={!open}>
              <nav className={cn(h.sheet, s.menuSheet)} aria-label={t('menuLabel')}>
                {MENU.map((key) => (
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
    </div>
  );
}
