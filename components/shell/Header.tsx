'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import type { MouseEvent } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import styles from './header.module.css';

export interface HeaderUser {
  /** Нік; з нього береться літера аватара й назва кнопки. */
  name: string;
}

export interface HeaderProps {
  /** Є активний Новорічний пас: «Пас ✓» / «Новорічний пас ✓». */
  hasPass?: boolean;
  /** Увійшла людина: аватар замість входу. */
  user?: HeaderUser | null;
  /** Поточна сторінка навігації. */
  current?: 'home' | 'countries';
  /** Код мови для кнопки («УКР») і її назва мовою інтерфейсу. */
  language?: { code: string; name: string };
  /** Відкрити повноекранне меню (телефон, планшет). */
  onMenuClick?: () => void;
  menuOpen?: boolean;
  /** Відкрити панель мови (планшет, десктоп) — панель на місці чату, не на відео. */
  onLanguageClick?: () => void;
  languageOpen?: boolean;
  /** «Увійти»: сторінка входу; `onSignInClick` може відкрити вхід вікном (трансляція грає) — `preventDefault`. */
  signInHref?: string;
  /** Сторінка входу відкрита — «Увійти» позначено поточною. */
  signInCurrent?: boolean;
  onSignInClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  className?: string;
}

const PASS_ICON_ACTIVE = 'ticket-check' as const;

/**
 * Хедер (ІНВ C23) за макетами `Main` / `Phone-Home-Live`. Телефон 56 px: знак, «Пас», вхід / аватар, «Меню».
 * Планшет: + «Головна», «Країни», мова. Десктоп 64 px: знак, «Головна», «Країни» (підкреслення поточної),
 * мова «УКР ⌄», «Підтримати», «Новорічний пас» (рамка), «Увійти»; меню немає.
 * Поверхня змінюється лише CSS (`header.module.css`), тож на сервері й клієнті розмітка однакова.
 */
export function Header({
  hasPass = false,
  user = null,
  current,
  language = { code: 'УКР', name: 'Українська' },
  onMenuClick,
  menuOpen = false,
  onLanguageClick,
  languageOpen = false,
  signInHref = '/login/',
  signInCurrent = false,
  onSignInClick,
  className,
}: HeaderProps) {
  const t = useTranslations('header');

  return (
    <header className={cn(styles.header, className)}>
      <div className={styles.bar}>
        <NextLink href="/" aria-label={t('logoLabel')} className={cn('t2f-focus rounded-sm', styles.logo)}>
          {/* Знак із макетів (PNG 300×86); ширина 112 px телефон / 150 px ширше. */}
          {/* eslint-disable-next-line @next/next/no-img-element -- статичний експорт, зображення вже потрібного розміру */}
          <img src="/brand/logo.png" alt="" width={150} height={43} />
        </NextLink>

        <nav aria-label={t('navLabel')} className={styles.nav}>
          <NextLink href="/" aria-current={current === 'home' ? 'page' : undefined} className={cn('t2f-focus', styles.navLink)}>
            {t('home')}
          </NextLink>
          <NextLink
            href="/countries"
            aria-current={current === 'countries' ? 'page' : undefined}
            className={cn('t2f-focus', styles.navLink)}
          >
            {t('countries')}
          </NextLink>
        </nav>

        <button
          type="button"
          className={cn('t2f-focus', styles.btn, styles.lang, styles.tabletUp)}
          aria-label={t('language', { language: language.name })}
          aria-expanded={languageOpen}
          onClick={onLanguageClick}
        >
          <Icon name="globe" size={18} />
          {language.code}
          <Icon name="chevron-down" size={14} strokeWidth={2} />
        </button>

        {/* «Підтримати» — інертне посилання: чайові (O-TIPS) з'являться в наступній області. */}
        <NextLink href="#" className={cn('t2f-focus', styles.btn, styles.deskOnly)}>
          <Icon name="heart" size={18} />
          {t('support')}
        </NextLink>

        {/* «Пас» — інертне посилання до S-PASS (наступна область). Телефон і планшет: коротко. */}
        <NextLink
          href="#"
          aria-label={hasPass ? t('passActiveA11y') : t('passA11y')}
          className={cn('t2f-focus', styles.btn, styles.pass, styles.phoneTablet)}
        >
          <Icon name={hasPass ? PASS_ICON_ACTIVE : 'ticket'} size={18} />
          {hasPass ? t('passShortActive') : t('passShort')}
        </NextLink>
        {/* Десктоп: повна назва. */}
        <NextLink
          href="#"
          aria-label={hasPass ? t('passFullActiveA11y') : undefined}
          className={cn('t2f-focus', styles.btn, styles.pass, styles.deskOnly)}
        >
          <Icon name={hasPass ? PASS_ICON_ACTIVE : 'ticket'} size={18} />
          {hasPass ? t('passFullActive') : t('passFull')}
        </NextLink>

        {/* Вхід — сторінка `/login/` (або вікно під час трансляції); профіль — наступна ітерація (меню профілю). */}
        {user ? (
          <NextLink href="#" aria-label={t('profile', { name: user.name })} className={cn('t2f-focus', styles.iconBtn)}>
            <span aria-hidden="true" className={styles.avatar}>
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
          </NextLink>
        ) : (
          <>
            <NextLink href={signInHref} onClick={onSignInClick} aria-current={signInCurrent ? 'page' : undefined} aria-label={t('signIn')} className={cn('t2f-focus', styles.iconBtn, styles.phoneTablet)}>
              <Icon name="user" size={22} />
            </NextLink>
            <NextLink href={signInHref} onClick={onSignInClick} aria-current={signInCurrent ? 'page' : undefined} className={cn('t2f-focus', styles.btn, styles.signIn, styles.deskOnly)}>
              <Icon name="user" size={18} />
              {t('signIn')}
            </NextLink>
          </>
        )}

        <button
          type="button"
          aria-label={t('menu')}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={onMenuClick}
          className={cn('t2f-focus', styles.iconBtn, styles.phoneTablet)}
        >
          <Icon name="menu" size={22} />
        </button>
      </div>
    </header>
  );
}
