'use client';

import { useTranslations } from 'next-intl';
import NextLink from 'next/link';
import { Button } from '@/components/primitives/Button';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { IconButton, IconLink } from '@/components/primitives/IconButton';
import { Link } from '@/components/primitives/Link';
import { Logo } from '@/components/primitives/Logo';

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
  className?: string;
}

const PASS_ICON_ACTIVE = 'ticket-check' as const;

/**
 * Хедер (ІНВ C23). Телефон 56 px: логотип, «Пас», вхід / аватар, «Меню».
 * Планшет: + «Головна», «Країни», мова. Десктоп 64 px: логотип, «Головна», «Країни», мова,
 * «Підтримати», «Новорічний пас», «Увійти» / аватар; меню немає.
 * Поверхня змінюється лише CSS (помічники `t2f-hide-*` у primitives.css), тож на сервері й клієнті розмітка однакова.
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
  className,
}: HeaderProps) {
  const t = useTranslations('header');

  return (
    <header
      className={cn(
        'border-b border-border bg-background',
        className,
      )}
    >
      <div className="mx-auto flex h-14 max-w-content-max items-center gap-1 ps-4 pe-1 md:h-16 md:gap-2 md:px-8">
        <Logo label={t('logoLabel')} className="me-auto" />

        <nav aria-label={t('navLabel')} className="t2f-hide-until-tablet me-2 flex items-center gap-1">
          <Link variant="nav" href="/" current={current === 'home'}>
            {t('home')}
          </Link>
          <Link variant="nav" href="/countries" current={current === 'countries'}>
            {t('countries')}
          </Link>
        </nav>

        <Button
          variant="ghost"
          iconLeft="globe"
          className="t2f-hide-until-tablet"
          aria-label={t('language', { language: language.name })}
          aria-expanded={languageOpen}
          onClick={onLanguageClick}
        >
          {language.code}
        </Button>

        {/* «Підтримати» — інертне посилання: чайові (O-TIPS) з'являться в наступній області. */}
        <Button variant="tonal" asChild className="t2f-hide-until-desktop">
          <NextLink href="#">{t('support')}</NextLink>
        </Button>

        {/* «Пас» — інертне посилання до S-PASS (наступна область). Телефон і планшет: коротко. */}
        <Button
          variant="secondary"
          size="md"
          compact
          asChild
          className="t2f-hide-from-desktop"
        >
          <NextLink href="#" aria-label={hasPass ? t('passActiveA11y') : t('passA11y')}>
            <Icon name={hasPass ? PASS_ICON_ACTIVE : 'ticket'} size={18} />
            {hasPass ? t('passShortActive') : t('passShort')}
          </NextLink>
        </Button>
        {/* Десктоп: повна назва. */}
        <Button variant="secondary" size="md" asChild className="t2f-hide-until-desktop">
          <NextLink href="#" aria-label={hasPass ? t('passFullActiveA11y') : t('passFull')}>
            <Icon name={hasPass ? PASS_ICON_ACTIVE : 'ticket'} size={18} />
            {hasPass ? t('passFullActive') : t('passFull')}
          </NextLink>
        </Button>

        {/* Вхід / профіль — інертні (наступна область). */}
        {user ? (
          <NextLink
            href="#"
            aria-label={t('profile', { name: user.name })}
            className="t2f-focus inline-flex size-touch-min items-center justify-center rounded-full"
          >
            <span
              aria-hidden="true"
              className="inline-flex size-8 items-center justify-center rounded-full bg-surface-raised text-label-sm text-text"
            >
              {user.name.trim().charAt(0).toUpperCase()}
            </span>
          </NextLink>
        ) : (
          <>
            <IconLink icon="user" aria-label={t('signIn')} href="#" className="t2f-hide-from-desktop" iconSize={22} />
            <Button variant="ghost" asChild className="t2f-hide-until-desktop">
              <NextLink href="#">{t('signIn')}</NextLink>
            </Button>
          </>
        )}

        <IconButton
          icon="menu"
          iconSize={22}
          aria-label={t('menu')}
          aria-expanded={menuOpen}
          aria-haspopup="dialog"
          onClick={onMenuClick}
          className="t2f-hide-from-desktop"
        />
      </div>
    </header>
  );
}
