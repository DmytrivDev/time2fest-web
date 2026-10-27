'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import NextLink from 'next/link';
import { Switch } from '@/components/primitives/Switch';
import { useGuestStore } from '@/stores/guest';

export interface FooterProps {
  /** Керований режим (історії, тести); без нього «Зменшити рух» читається й пишеться в стор гостя. */
  reducedMotion?: boolean;
  onReducedMotionChange?: (value: boolean) => void;
  /** Відкрити налаштування cookies (B-COOKIES); без обробника — інертне посилання. */
  onCookiesClick?: () => void;
  className?: string;
}

const LINKS = ['help', 'privacy', 'terms', 'payments'] as const;

/**
 * Футер (ІНВ C23): «Допомога», «Політика конфіденційності», «Умови», «Оплата й повернення», «Налаштування cookies»,
 * попередження про спалахи й перемикач «Зменшити рух». Телефон: посилання — рядки ≥ 44 px; ширше — один рядок.
 * Сторінки юридичних текстів і допомоги — наступна область, тому посилання поки інертні.
 */
export function Footer({ reducedMotion, onReducedMotionChange, onCookiesClick, className }: FooterProps) {
  const t = useTranslations('footer');
  const stored = useGuestStore((s) => s.reducedMotion);
  const setStored = useGuestStore((s) => s.setReducedMotion);
  const checked = reducedMotion ?? stored;

  const link = 't2f-focus t2f-transition inline-flex min-h-touch-min items-center rounded-sm text-body text-text-muted underline underline-offset-2 hover:text-text';
  return (
    <footer className={cn('mt-8 border-t border-border bg-background', className)}>
      {/* Макети: телефон — посилання в рядки з проміжком 20 (поля 8/16/16); ширше — один рядок 32 px від краю. */}
      <div className="mx-auto flex max-w-content-max flex-wrap items-center gap-x-5 px-4 pb-4 pt-2 md:gap-y-1 md:px-8 md:py-1.5">
        <nav aria-label={t('navLabel')} className="contents">
          {LINKS.map((key) => (
            <NextLink key={key} href="#" className={link}>
              {key === 'privacy' ? (
                <>
                  <span className="md:hidden">{t('privacyShort')}</span>
                  <span className="max-md:hidden">{t(key)}</span>
                </>
              ) : (
                t(key)
              )}
            </NextLink>
          ))}
          {onCookiesClick ? (
            <button type="button" onClick={onCookiesClick} className={cn(link, 'text-start')}>
              {t('cookies')}
            </button>
          ) : (
            <NextLink href="#" className={link}>
              {t('cookies')}
            </NextLink>
          )}
        </nav>
        <span className="hidden flex-1 md:block" aria-hidden="true" />
        <p className="py-2 text-caption text-text-muted md:py-0 md:text-body">{t('flashWarning')}</p>
        <Switch
          compact
          labelSide="end"
          label={t('reduceMotion')}
          checked={checked}
          onCheckedChange={(v) => {
            setStored(v);
            onReducedMotionChange?.(v);
          }}
        />
      </div>
    </footer>
  );
}
