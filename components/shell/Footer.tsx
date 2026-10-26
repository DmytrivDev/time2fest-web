'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
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

  return (
    <footer className={cn('mt-8 border-t border-border bg-background', className)}>
      <div className="mx-auto flex max-w-content-max flex-col px-4 pb-4 pt-2 md:flex-row md:flex-wrap md:items-center md:gap-x-5 md:px-8 md:py-1.5">
        <nav aria-label={t('navLabel')} className="contents">
          {LINKS.map((key) => (
            <Link key={key} variant="footer" href="#">
              {t(key)}
            </Link>
          ))}
          {onCookiesClick ? (
            <button
              type="button"
              onClick={onCookiesClick}
              className="t2f-focus t2f-transition flex min-h-touch-min items-center rounded-sm text-start text-caption text-text-muted hover:text-text md:inline-flex"
            >
              {t('cookies')}
            </button>
          ) : (
            <Link variant="footer" href="#">
              {t('cookies')}
            </Link>
          )}
        </nav>
        <span className="hidden flex-1 md:block" aria-hidden="true" />
        <p className="py-2 text-caption text-text-muted md:py-0">{t('flashWarning')}</p>
        <Switch
          compact
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
