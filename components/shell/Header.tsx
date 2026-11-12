'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { useLayoutEffect, useRef, useState, type CSSProperties, type MouseEvent } from 'react';
import { cn } from '@/components/primitives/cn';
import { roundFlagSrc } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { DemoClock } from '@/components/demo/DemoClock';
import { IS_DEMO_BUILD } from '@/lib/env';
import { useUnreadCount } from '@/stores/notifications';
import { CelebrationBackdrop, CelebrationContent, type HeaderCelebrationProps } from './HeaderCelebration';
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
  current?: 'home' | 'countries' | 'about';
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
  /** Нових сповіщень; без значення — непрочитані зі стору сповіщень. */
  notifications?: number;
  onNotificationsClick?: () => void;
  /** Демо: годинник «Машини часу»; без обробника відкриває своє бічне вікно. */
  onTimeMachineClick?: () => void;
  timeMachineOpen?: boolean;
  /**
   * Свято штампа (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header`, 2026-11-12): шапка ≈ 10 с золота в межах своєї висоти;
   * лого, навігація, годинник, «Підтримати», «Пас» і (телефон) меню гаснуть, капсула «моє» лишається — туди летить штамп.
   */
  celebration?: HeaderCelebrationProps | null;
  /** Наведення мишею / фокус у шапці — свято на паузі (WCAG 2.2.1). */
  onCelebrationHold?: (reason: 'hover' | 'focus', on: boolean) => void;
  /** Після свята аватар один раз світиться золотом (≈ 1,5 с). */
  avatarGlow?: boolean;
  className?: string;
}

/** Аватар: круглий прапор під темною вуаллю й перша літера; з пасом — золоте кільце й ярлик «ПАС». */
export function HeaderAvatar({ user, pass, label }: { user: HeaderUser; pass: boolean; label: string }) {
  const src = user.flag ? roundFlagSrc(user.flag) : null;
  return (
    <span aria-hidden="true" data-header-avatar="" className={cn(styles.avatar, pass && styles.avatarPass)} style={src ? { backgroundImage: `linear-gradient(rgb(0 0 0 / 0.55), rgb(0 0 0 / 0.55)), url(${src})` } : undefined}>
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
 * Свято штампа (дошки `Desk-Stamp-Header` / `Phone-Stamp-Header` v2, 2026-11-12): `celebration` — шапка ≈ 10 с золота строго
 * у своїй висоті (`HeaderCelebration`); гаснуть лого, навігація, годинник демо, «Підтримати», «Пас», на телефоні — меню;
 * лишається капсула «моє» (телефон — кабінет і дзвіночок, зсунуті на місце меню). Після свята аватар світиться (`avatarGlow`).
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
  onTimeMachineClick,
  timeMachineOpen,
  celebration = null,
  onCelebrationHold,
  avatarGlow = false,
  className,
}: HeaderProps) {
  const t = useTranslations('header');
  const unread = useUnreadCount();
  const count = notifications ?? unread;

  // Свято: вміст займає місце від лівого поля до капсули «моє» (на телефоні капсула зсувається на місце меню).
  const bar = useRef<HTMLDivElement>(null);
  const mine = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLButtonElement>(null);
  const [right, setRight] = useState<number | null>(null);
  const celebrationId = celebration?.celebration.id;
  useLayoutEffect(() => {
    if (celebrationId === undefined) return;
    const measure = () => {
      if (!bar.current || !mine.current) return;
      const phone = typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 767.98px)').matches;
      const shift = phone && menu.current ? menu.current.offsetWidth : 0;
      setRight(bar.current.clientWidth - mine.current.offsetLeft - shift + (phone ? 0 : 16));
    };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [celebrationId]);

  return (
    <header
      className={cn(styles.header, className)}
      data-celebration={celebration ? celebration.phase : undefined}
      data-celebration-paused={celebration?.paused || undefined}
      onPointerEnter={onCelebrationHold ? (e) => e.pointerType === 'mouse' && onCelebrationHold('hover', true) : undefined}
      onPointerLeave={onCelebrationHold ? (e) => e.pointerType === 'mouse' && onCelebrationHold('hover', false) : undefined}
      onFocus={onCelebrationHold ? () => onCelebrationHold('focus', true) : undefined}
      onBlur={
        onCelebrationHold
          ? (e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) onCelebrationHold('focus', false);
            }
          : undefined
      }
    >
      {celebration ? <CelebrationBackdrop reduced={celebration.reduced} /> : null}
      <div ref={bar} className={styles.bar} style={celebration && right !== null ? ({ '--celebration-right': `${right}px` } as CSSProperties) : undefined}>
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
          {/* «Про нас» — сторінка `/about/` (2026-11-09). */}
          <NextLink href="/about/" aria-current={current === 'about' ? 'page' : undefined} className={cn('t2f-focus', styles.navLink)}>
            {t('about')}
          </NextLink>
        </nav>

        <span className={styles.spacer} />

        {/* Демо: «Машина часу» — перша дія праворуч (власник 2026-11-11). */}
        {IS_DEMO_BUILD ? (
          <DemoClock onClick={onTimeMachineClick} open={timeMachineOpen} className={cn('t2f-focus', styles.icon, styles.clock)} />
        ) : null}

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
        <div ref={mine} className={styles.mine} data-header-mine="">
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
            <NextLink
              href="/account/"
              aria-label={hasPass ? t('profilePass', { name: user.name }) : t('profile', { name: user.name })}
              data-header-account=""
              data-glow={avatarGlow || undefined}
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
              data-header-account=""
              data-glow={avatarGlow || undefined}
              className={cn('t2f-focus', styles.text, styles.account, styles.signIn)}
            >
              <Icon name="user" size={20} />
              <span className={styles.label}>{t('signIn')}</span>
            </NextLink>
          )}
          <span aria-hidden="true" className={styles.sep} />
          <button
            ref={menu}
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
        {celebration ? <CelebrationContent key={celebration.celebration.id} {...celebration} /> : null}
      </div>
    </header>
  );
}
