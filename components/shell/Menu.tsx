'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { usePathname } from 'next/navigation';
import { Dialog, RadioGroup, VisuallyHidden } from 'radix-ui';
import { useRef, type CSSProperties, type MouseEvent, type ReactNode } from 'react';
import { useHeaderUser } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Logo } from '@/components/primitives/Logo';
import { Switch } from '@/components/primitives/Switch';
import { currentPath, rememberReturn } from '@/lib/auth/returnTo';
import { useSheetTop } from '@/lib/overlay/sheetTop';
import { usePartyHref } from './OverlayManager';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { HeaderAvatar } from './Header';
import ms from './menu.module.css';

export interface MenuLanguage {
  code: string;
  /** Назва мовою самого пункту (без прапора). */
  name: string;
}

/** Порядок — англійська, іспанська, французька, українська (рішення власника 2026-11-08). */
export const MENU_LANGUAGES: MenuLanguage[] = [
  { code: 'en', name: 'English' },
  { code: 'es', name: 'Español' },
  { code: 'fr', name: 'Français' },
  { code: 'uk', name: 'Українська' },
];

export interface MenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Поточна сторінка. */
  current?: 'home' | 'countries' | 'about';
  language?: string;
  languages?: MenuLanguage[];
  onLanguageChange?: (code: string) => void;
  /** Назва місця, відео з якого стоїть на паузі («Лондон»); без неї рядок паузи не показується. */
  pausedPlace?: string;
  hasPass?: boolean;
  signedIn?: boolean;
  /** «Увійти» гостя: сторінка входу або (`onSignIn`) вікно входу під трансляцією. */
  onSignIn?: () => void;
  /** «Новорічний пас»: сторінка `/pass/` або (`onPass`) вікно оформлення під трансляцією. */
  onPass?: () => void;
  /** Штампів (підпис «Мій паспорт»); без значення — зі стору гостя. */
  stampCount?: number;
  /** Керований «Зменшити рух» (історії, тести); без нього — стор гостя. */
  reducedMotion?: boolean;
  onReducedMotionChange?: (value: boolean) => void;
}

function Row({
  href = '#',
  icon,
  title,
  hint,
  tag,
  highlight,
  current,
  className,
  onNavigate,
}: {
  href?: string;
  icon: IconName;
  title: ReactNode;
  hint?: ReactNode;
  tag?: ReactNode;
  highlight?: boolean;
  current?: boolean;
  className?: string;
  onNavigate: (e: MouseEvent<HTMLAnchorElement>) => void;
}) {
  return (
    <li className={className}>
      <NextLink href={href} aria-current={current ? 'page' : undefined} onClick={onNavigate} className={cn('t2f-focus t2f-transition', ms.row)}>
        <span aria-hidden="true" className={cn(ms.tile, highlight && ms.tileGold)}>
          <Icon name={icon} size={18} />
        </span>
        <span className={ms.rowText}>
          <span className={ms.rowTitle}>{title}</span>
          {hint ? <span className={ms.rowHint}>{hint}</span> : null}
        </span>
        {tag ?? <Icon name="chevron-right" size={16} className={ms.chev} />}
      </NextLink>
    </li>
  );
}

function Section({ title, className, children }: { title: string; className?: string; children: ReactNode }) {
  return (
    <section className={cn(ms.section, className)}>
      <h3 className={ms.sectionTitle}>{title}</h3>
      <ul className={ms.list}>{children}</ul>
    </section>
  );
}

export interface MenuBodyProps extends Omit<MenuProps, 'open' | 'onOpenChange'> {
  /** Закрити меню (після переходу чи виходу). */
  onClose: () => void;
  /**
   * Не закривати меню при переході на сторінку (вікно `O-MENU` на `(live)`, власник 2026-11-08): лейаут `(live)` живе між
   * сторінками, тож змінюється лише вміст, а меню на новій сторінці вже відкрите. Radix-варіант (`Menu`) закривається.
   */
  keepOpenOnNavigate?: boolean;
}

/**
 * Вміст меню за дошкою `Desk-Menu-New` v2 (рішення власника 2026-11-08): мова — угорі одним рядом (EN · ES · FR · УКР, ширина
 * за вмістом); картка людини (гість — «Увійти»; увійшла — аватар, ім’я · кабінет, пошта або «Новорічний пас активний»);
 * «Сайт» (телефон і планшет — на десктопі це в шапці); «Моє свято» (паспорт, графік — без пасу з ярликом «Пас»);
 * «Дивитися» (кімната перегляду, режим вечірки, рейтинг); «Ще» («Тости» — десктоп, допомога, «Зменшити рух»);
 * «Тости» (було «Підтримати», рішення власника 2026-11-13) — сторінка «Тости світу» `/support/` у всі періоди свята;
 * «Вийти» — у кінці списку (до нього гортають; власник 2026-11-08).
 * На сторінках `(live)` вміст відкривається вікном `O-MENU` через `OverlayManager` (десктоп — на місці чату, телефон — шторка
 * до відео), поза ними — `Menu` (Radix Dialog).
 */
export function MenuBody({
  current,
  language: languageProp,
  languages = MENU_LANGUAGES,
  onLanguageChange,
  pausedPlace,
  hasPass: hasPassProp,
  signedIn: signedInProp,
  onSignIn,
  onPass,
  stampCount,
  reducedMotion,
  onReducedMotionChange,
  onClose,
  keepOpenOnNavigate = false,
}: MenuBodyProps) {
  const t = useTranslations('menu');
  const th = useTranslations('header');
  const stored = useGuestStore((s) => s.reducedMotion);
  const setStored = useGuestStore((s) => s.setReducedMotion);
  const storedPass = useGuestStore((s) => s.hasPass);
  const stamps = useGuestStore((s) => s.stamps.length);
  // Мова — у сторі гостя (запам’ятовується); перекладів ще немає.
  const storedLocale = useGuestStore((s) => s.locale);
  const email = useAuthStore((s) => s.user?.email ?? null);
  const signOut = useAuthStore((s) => s.signOut);
  const user = useHeaderUser();
  const signedIn = signedInProp ?? Boolean(user);
  const hasPass = hasPassProp ?? (Boolean(user) && storedPass);
  const motion = reducedMotion ?? stored;
  const language = languageProp ?? storedLocale ?? 'uk';
  const pathname = usePathname();
  const here = (href: string) => href !== '#' && !!pathname?.startsWith(href.replace(/\/$/, ''));
  // Поточна сторінка — з адреси (меню лишається відкритим між сторінками); `current` — для історій і тестів без роутера.
  const page =
    pathname === '/' ? 'home' : pathname?.startsWith('/countries') || pathname?.startsWith('/country/') ? 'countries' : pathname?.startsWith('/about') ? 'about' : pathname ? undefined : current;
  const count = stampCount ?? stamps;
  const close = onClose;
  // Перехід на сторінку: у вікні `O-MENU` меню лишається відкритим, у Radix-варіанті — закривається.
  const navigate = keepOpenOnNavigate ? () => undefined : close;
  // «Режим вечірки»: телефон і планшет-портрет — інформаційна сторінка `/tv-info/` (2026-11-10).
  const partyHref = usePartyHref();

  return (
    <div className={ms.content} data-menu-body="">
      {pausedPlace ? (
        <div role="status" className={ms.paused}>
          <Icon name="pause" size={16} />
          <span>{t('playerPaused', { place: pausedPlace })}</span>
        </div>
      ) : null}

      {/* Мова — угорі, одним рядом; окремої кнопки мови в шапці немає. */}
      <RadioGroup.Root
        aria-label={t('language')}
        value={language}
        onValueChange={(v) => {
          useGuestStore.setState({ locale: v as typeof storedLocale });
          onLanguageChange?.(v);
        }}
        orientation="horizontal"
        className={ms.langs}
      >
        {languages.map((l) => (
          <RadioGroup.Item key={l.code} value={l.code} lang={l.code} className={cn('t2f-focus t2f-transition', ms.lang)}>
            {l.name}
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>

      {user ? (
        <NextLink href="/account/" onClick={close} className={cn('t2f-focus t2f-transition', ms.card)} data-block="menu-account">
          <span className={ms.avatar}>
            <HeaderAvatar user={user} pass={hasPass} label={th('passLabel')} />
          </span>
          <span className={ms.cardText}>
            <span className={ms.cardName}>
              {user.name} <span className={ms.cardCabinet}>· {t('cabinet')}</span>
            </span>
            {hasPass ? (
              <span className={ms.passChip}>
                <Icon name="ticket" size={14} />
                {t('passActive')}
              </span>
            ) : (
              <span className={ms.cardEmail}>{email}</span>
            )}
          </span>
          <Icon name="chevron-right" size={16} className={ms.chev} />
        </NextLink>
      ) : (
        <div className={ms.guest} data-block="menu-guest">
          <p className={ms.guestTitle}>{t('guestTitle')}</p>
          <p className={ms.guestText}>{t('guestText')}</p>
          <NextLink
            href="/login/"
            onClick={(e) => {
              if (onSignIn) {
                e.preventDefault();
                onSignIn();
              } else {
                rememberReturn(currentPath());
                close();
              }
            }}
            className={cn('t2f-focus t2f-transition', ms.signIn)}
          >
            <Icon name="user" size={18} />
            {t('signIn')}
          </NextLink>
        </div>
      )}

      <nav aria-label={t('navLabel')}>
        <Section title={t('sectionSite')} className={ms.notDesk}>
          <Row href="/" icon="home" title={t('home')} current={page === 'home'} onNavigate={navigate} />
          <Row href="/countries" icon="map" title={t('countries')} current={page === 'countries'} onNavigate={navigate} />
          <Row href="/about/" icon="info" title={t('about')} current={page === 'about'} onNavigate={navigate} />
          <Row href="/support/" icon="glass" title={t('toasts')} hint={t('toastsHint')} highlight current={here('/support/')} onNavigate={navigate} />
        </Section>
        <Section title={t('sectionMine')}>
          <Row
            href="/passport/"
            icon="passport"
            title={t('passport')}
            hint={signedIn ? t('passportHintAccount', { count }) : t('passportHint', { count })}
            current={here('/passport/')}
            onNavigate={navigate}
          />
          <Row
            href="/schedule/"
            icon="calendar"
            title={t('schedule')}
            hint={t('scheduleHint')}
            current={here('/schedule/')}
            tag={
              hasPass ? undefined : (
                <span className={ms.passTag}>
                  <Icon name="ticket" size={12} />
                  {t('passTag')}
                </span>
              )
            }
            onNavigate={(e) => {
              // Без пасу «Мій графік» показує, що дає пас: оформлення вікном (свято йде) чи сторінка графіка.
              if (!hasPass && onPass) {
                e.preventDefault();
                onPass();
              } else navigate();
            }}
          />
        </Section>
        <Section title={t('sectionWatch')}>
          <Row href="/room/" icon="grid4" title={t('room')} hint={t('roomHint')} current={here('/room/')} onNavigate={navigate} />
          <Row href={partyHref} icon="tv" title={t('partyMode')} hint={t('partyHint')} current={here('/tv-info/')} onNavigate={navigate} />
          <Row href="/rating/" icon="star" title={t('rating')} current={here('/rating/')} onNavigate={navigate} />
        </Section>
        <Section title={t('sectionMore')}>
          <Row href="/support/" icon="glass" title={t('toasts')} hint={t('toastsHint')} highlight current={here('/support/')} className={ms.deskOnly} onNavigate={navigate} />
          <Row href="/help/" icon="help" title={t('help')} current={here('/help/')} onNavigate={navigate} />
          <li>
            <Switch
              label={
                <span className={ms.switchLabel}>
                  <span aria-hidden="true" className={ms.tile}>
                    <Icon name="motion" size={18} />
                  </span>
                  <span className={ms.rowTitle}>{t('reduceMotion')}</span>
                </span>
              }
              checked={motion}
              onCheckedChange={(v) => {
                setStored(v);
                onReducedMotionChange?.(v);
              }}
              className={ms.switchRow}
            />
          </li>
        </Section>
      </nav>

      {/* «Вийти» — у кінці списку, до нього гортають (не закріплене; власник 2026-11-08). */}
      {signedIn ? (
        <button
          type="button"
          onClick={() => {
            signOut();
            close();
          }}
          className={cn('t2f-focus t2f-transition', ms.signOut)}
        >
          <Icon name="sign-out" size={18} />
          {t('signOut')}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Бічне вікно поза `(live)` (службові сторінки, пас, вхід, 404) — Radix Dialog: десктоп — панель праворуч під шапкою,
 * телефон і планшет-портрет — шторка до низу відео / шапки + 16:9 без затемнення (2026-11-10), планшет-альбом — на весь екран. Спільне для меню й сповіщень.
 */
export function SideDialog({
  open,
  onOpenChange,
  title,
  onBack,
  logo = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Другий рівень («‹ Назад»). */
  onBack?: () => void;
  /** Лого замість назви на планшеті (меню). */
  logo?: boolean;
  children: ReactNode;
}) {
  const t = useTranslations('menu');
  const th = useTranslations('header');
  // Телефон і планшет-портрет — шторка; верх — за правилом сайту (під відео / шапка + 16:9, 2026-11-10).
  const top = useSheetTop('video', open);
  // Вікно відкривається без Dialog.Trigger (кнопка — у хедері), тож Radix не знає, куди повернути фокус:
  // запам’ятовуємо елемент з фокусом до відкриття й повертаємо на нього після закриття (WCAG 2.4.3).
  const returnFocus = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Content
          data-menu=""
          aria-describedby={undefined}
          onOpenAutoFocus={() => {
            const el = document.activeElement;
            returnFocus.current = el instanceof HTMLElement && el !== document.body ? el : null;
          }}
          onCloseAutoFocus={(e) => {
            if (!returnFocus.current?.isConnected) return;
            e.preventDefault();
            returnFocus.current.focus();
          }}
          className={cn('text-text', ms.panel)}
          style={top !== undefined ? ({ '--menu-top': `${top}px` } as CSSProperties) : undefined}
        >
          <span aria-hidden="true" className={ms.handle} />
          <header className={ms.head}>
            {onBack ? (
              <button type="button" onClick={onBack} className={cn('t2f-focus', ms.back)}>
                <Icon name="chevron-left" size={18} />
                {t('back')}
              </button>
            ) : null}
            {logo && !onBack ? <Logo label={th('logoLabel')} className={cn('me-auto', ms.logo)} /> : null}
            <span aria-hidden="true" className={cn(ms.title, !logo && ms.titleAlways)}>
              {title}
            </span>
            <VisuallyHidden.Root asChild>
              <Dialog.Title>{title}</Dialog.Title>
            </VisuallyHidden.Root>
            <Dialog.Close asChild>
              <IconButton icon="close" iconSize={20} aria-label={t('closeWindow')} className={ms.close} />
            </Dialog.Close>
          </header>
          <div className={ms.body}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

/** Меню поза `(live)` — у бічному вікні (`SideDialog`). */
export function Menu({ open, onOpenChange, ...rest }: MenuProps) {
  const t = useTranslations('menu');
  return (
    <SideDialog open={open} onOpenChange={onOpenChange} title={t('title')} logo>
      <MenuBody {...rest} onClose={() => onOpenChange(false)} />
    </SideDialog>
  );
}
