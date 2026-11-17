'use client';

/** Шапка головної «до свята»: логотип, три посилання, мова (заглушка); на телефоні — кнопка «Меню». Без входу, тостів, паса й дзвінка. */
import { useEffect, useRef, useState } from 'react';
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Icon } from '@/components/primitives/Icon';
import { Logo } from '@/components/primitives/Logo';
import { cn } from '@/components/primitives/cn';
import { usePrefest } from './PrefestContext';
import h from './PrefestHeader.module.css';
import s from './prefest.module.css';

export function PrefestHeader() {
  const t = useTranslations('prefest.header');
  const { toast } = usePrefest();
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

  const language = t('language', { language: t('languageName') });
  return (
    <header className={h.hd}>
      <div className={cn(s.wrap, h.inner)}>
        <Logo href="/before/" label={t('logoLabel')} className={h.logo} />
        <nav aria-label={t('navLabel')} className={h.nav}>
          <NextLink href="/before/" aria-current="page">
            {t('home')}
          </NextLink>
          <NextLink href="/countries/">{t('countries')}</NextLink>
          <NextLink href="/about/">{t('about')}</NextLink>
        </nav>
        <button type="button" className={h.lang} aria-label={language} onClick={() => toast(t('languageSoon'))}>
          <Icon name="globe" size={16} />
          {t('languageName')}
        </button>
        <div className={h.menuWrap} ref={wrapRef}>
          <button
            type="button"
            ref={btnRef}
            className={h.menuBtn}
            aria-expanded={open}
            aria-haspopup="true"
            aria-controls="prefest-menu"
            aria-label={open ? t('menuClose') : undefined}
            onClick={() => setOpen((v) => !v)}
          >
            <Icon name={open ? 'close' : 'menu'} size={18} />
            {t('menu')}
          </button>
          {open ? (
            <nav id="prefest-menu" className={h.sheet} aria-label={t('menuLabel')}>
              <NextLink className={h.menuItem} href="/before/" aria-current="page" onClick={() => setOpen(false)}>
                {t('home')}
              </NextLink>
              <NextLink className={h.menuItem} href="/countries/" onClick={() => setOpen(false)}>
                {t('countries')}
              </NextLink>
              <NextLink className={h.menuItem} href="/about/" onClick={() => setOpen(false)}>
                {t('about')}
              </NextLink>
              <span className={h.sep} aria-hidden="true" />
              <button
                type="button"
                className={h.menuItem}
                onClick={() => {
                  setOpen(false);
                  toast(t('languageSoon'));
                }}
              >
                <Icon name="globe" size={16} />
                {language}
              </button>
            </nav>
          ) : null}
        </div>
      </div>
    </header>
  );
}
