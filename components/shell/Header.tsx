'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import type { MouseEvent } from 'react';
import { cn } from '@/components/primitives/cn';
import { roundFlagSrc } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useTestControls } from '@/stores/testControls';
import styles from './header.module.css';

export interface HeaderUser {
  /** Нік; з нього береться літера аватара й назва кнопки. */
  name: string;
  /** Прапор, обраний при реєстрації (ISO); фон аватара. */
  flag?: string;
}

export interface HeaderProps {
  /** Є активний Новорічний пас: кнопки «Новорічний пас» немає, на аватарі — золоте кільце й ярлик «ПАС». */
  hasPass?: boolean;
  /** Увійшла людина: аватар замість входу. */
  user?: HeaderUser | null;
  /** Поточна сторінка навігації. */
  current?: 'home' | 'countries';
  /** Відкрити меню (усі розміри). */
  onMenuClick?: () => void;
  menuOpen?: boolean;
  /** «Увійти»: сторінка входу; `onSignInClick` може відкрити вхід вікном (трансляція грає) — `preventDefault`. */
  signInHref?: string;
  /** Сторінка входу відкрита — «Увійти» позначено поточною. */
  signInCurrent?: boolean;
  onSignInClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** «Пас»: сторінка `/pass/`; `onPassClick` може відкрити оформлення вікном (трансляція грає) — `preventDefault`. */
  onPassClick?: (e: MouseEvent<HTMLAnchorElement>) => void;
  /** «Підтримати»: вікно «Чайові» (сторінки з плеєром); без обробника — сторінка `/support/`. */
  onSupportClick?: () => void;
  /** Сторінка пасу відкрита — «Пас» позначено поточною. */
  passCurrent?: boolean;
  /** Нових сповіщень; без значення — з тестових перемикачів (сповіщень ще немає). */
  notifications?: number;
  onNotificationsClick?: () => void;
  className?: string;
}

/** Аватар: круглий прапор під темною вуаллю й перша літера; з пасом — золоте кільце й ярлик «ПАС». */
export function HeaderAvatar({ user, pass, label }: { user: HeaderUser; pass: boolean; label: string }) {
  const src = user.flag ? roundFlagSrc(user.flag) : null;
  return (
    <span aria-hidden="true" className={cn(styles.avatar, pass && styles.avatarPass)} style={src ? { backgroundImage: `linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.55)), url(${src})` } : undefined}>
      {user.name.trim().charAt(0).toUpperCase()}
      {pass ? <span className={styles.passTag}>{label}</span> : null}
    </span>
  );
}

/**
 * Шапка за дошкою `Desk-Header-New2`, варіант C «Капсула „моє“» (рішення власника 2026-11-08).
 * Десктоп ≥ 1200, 64 px: лого · «Головна · Країни · Про нас» — текстом; «Підтримати» — текстом (мова — лише в меню, 2026-11-08); «Новорічний пас» —
 * єдина яскрава кнопка (золота; з пасом її немає); капсула «моє»: 🔔 з лічильником | «Увійти» / аватар | «☰ Меню».
 * Планшет 768–1199: навігація й «Підтримати» — у меню; лишаються лого, «Пас», капсула.
 * Телефон 56 px: лого · «Пас» · кабінет · 🔔 · ☰ (без напису). Поверхня змінюється лише CSS — розмітка однакова.
 */
export function Header({
  hasPass = false,
  user = null,
  current,
  onMenuClick,
  menuOpen = false,
  signInHref = '/login/',
  signInCurrent = false,
  onSignInClick,
  onPassClick,
  onSupportClick,
  passCurrent = false,
  notifications,
  onNotificationsClick,
  className,
}: HeaderProps) {
  const t = useTranslations('header');
  // TODO(сповіщення): справжнє джерело; поки — тестовий перемикач «Сповіщення (лічильник)».
  const testCount = useTestControls((s) => s.notifications);
  const count = notifications ?? testCount;

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
          <NextLink href="/countries" aria-current={current === 'countries' ? 'page' : undefined} className={cn('t2f-focus', styles.navLink)}>
            {t('countries')}
          </NextLink>
          {/* TODO(про нас): сторінки ще немає. */}
          <NextLink href="#" className={cn('t2f-focus', styles.navLink)}>
            {t('about')}
          </NextLink>
        </nav>

        <span className={styles.spacer} />

        {/* «Підтримати» — сторінка `/support/`; на сторінках із плеєром — вікно «Чайові» на місці чату. */}
        <NextLink
          href="/support/"
          onClick={(e) => {
            if (!onSupportClick) return;
            e.preventDefault();
            onSupportClick();
          }}
          className={cn('t2f-focus', styles.text, styles.deskOnly)}
        >
          <Icon name="heart" size={18} />
          {t('support')}
        </NextLink>

        {/* «Новорічний пас» — єдина яскрава кнопка (покупка); з пасом її немає — статус на аватарі. */}
        {hasPass ? null : (
          <NextLink
            href="/pass/"
            onClick={onPassClick}
            aria-current={passCurrent ? 'page' : undefined}
            aria-label={t('passFull')}
            className={cn('t2f-focus', styles.pass)}
          >
            <Icon name="ticket" size={18} />
            <span className={styles.passShort}>{t('passShort')}</span>
            <span className={styles.passFull}>{t('passFull')}</span>
          </NextLink>
        )}

        {/* Капсула «моє»: сповіщення | кабінет | меню. На телефоні — окремі значки без рамки. */}
        <div className={styles.mine}>
          <button
            type="button"
            onClick={onNotificationsClick}
            aria-label={t('notifications', { count })}
            className={cn('t2f-focus', styles.icon, styles.bell, count > 0 && styles.bellOn)}
          >
            <Icon name="bell" size={20} />
            {count > 0 ? (
              <span aria-hidden="true" className={styles.badge}>
                {count > 99 ? '99+' : count}
              </span>
            ) : null}
          </button>
          <span aria-hidden="true" className={styles.sep} />
          {user ? (
            // TODO(кабінет): сторінки ще немає.
            <NextLink
              href="#"
              aria-label={hasPass ? t('profilePass', { name: user.name }) : t('profile', { name: user.name })}
              className={cn('t2f-focus', styles.icon, styles.account)}
            >
              <HeaderAvatar user={user} pass={hasPass} label={t('passLabel')} />
            </NextLink>
          ) : (
            <NextLink
              href={signInHref}
              onClick={onSignInClick}
              aria-current={signInCurrent ? 'page' : undefined}
              aria-label={t('signIn')}
              className={cn('t2f-focus', styles.text, styles.account, styles.signIn)}
            >
              <Icon name="user" size={20} />
              <span className={styles.label}>{t('signIn')}</span>
            </NextLink>
          )}
          <span aria-hidden="true" className={styles.sep} />
          <button
            type="button"
            aria-label={t('menu')}
            aria-expanded={menuOpen}
            aria-haspopup="dialog"
            onClick={onMenuClick}
            className={cn('t2f-focus', styles.text, styles.menu)}
          >
            <Icon name={menuOpen ? 'close' : 'menu'} size={20} />
            <span className={styles.label}>{t('menu')}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
