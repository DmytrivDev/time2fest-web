'use client';

import { useTranslations } from 'next-intl';
import { useEffect, useRef, type ReactNode } from 'react';
import { formatCountdown, formatShortCountdown } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { cn } from './cn';

export type CountdownVariant = 'hero' | 'inline' | 'tv';
export type CountdownFormat = 'hms' | 'ms';

const DAY = 86_400_000;
const PLACEHOLDER = '––:––:––';

const SIZE: Record<CountdownVariant, string> = {
  hero: 'text-countdown-hero-mobile md:text-countdown-hero',
  inline: 'text-countdown-inline',
  tv: 'text-countdown-tv',
};

export interface CountdownProps {
  /** Момент, до якого рахуємо: мс epoch UTC або ISO. */
  target: number | string;
  variant?: CountdownVariant;
  /** `hms` — «00:22:15» · `ms` — «0:59» (остання хвилина). */
  format?: CountdownFormat;
  /**
   * Текстова назва відліку для зчитувача без секунд: «до півночі», «до Нового року · Київ» (без відмінювання).
   * Потрапляє в `aria-label`; щосекунди нічого не читається (`role="timer"`, без live-області).
   */
  label: string;
  /** Підпис під цифрами другорядним кольором («до першої півночі планети — Кірібаті»). */
  caption?: ReactNode;
  /** Викликається один раз, коли відлік досяг нуля. */
  onZero?: () => void;
  className?: string;
}

/**
 * P24. Відлік: один годинник на сайт (`useNow` з `TimeProvider`), `role="timer"`,
 * секунди приховані від зчитувача, цифри табличні (ширина не стрибає).
 */
export function Countdown({ target, variant = 'hero', format = 'hms', label, caption, onZero, className }: CountdownProps) {
  const t = useTranslations('primitives.countdown');
  const now = useNow();
  const ready = now > 0; // до гідратації/синхронізації час невідомий (0)
  const end = typeof target === 'number' ? target : Date.parse(target);
  const remaining = Math.max(0, end - now);
  const done = ready && remaining === 0;
  const days = Math.floor(remaining / DAY);

  const fired = useRef(false);
  useEffect(() => {
    if (done && !fired.current) {
      fired.current = true;
      onZero?.();
    }
    if (!done) fired.current = false;
  }, [done, onZero]);

  // Для зчитувача: до хвилини вгору; змінюється раз на хвилину, а не щосекунди.
  const totalMinutes = Math.ceil(remaining / 60_000);
  const spoken = !ready
    ? undefined
    : done
      ? t('spokenZero')
      : t('spoken', {
          days: Math.floor(totalMinutes / 1440),
          hours: Math.floor((totalMinutes % 1440) / 60),
          minutes: totalMinutes % 60,
        });

  const digits = !ready
    ? PLACEHOLDER
    : format === 'ms'
      ? formatShortCountdown(remaining)
      : `${days > 0 ? `${t('days', { days })} ` : ''}${formatCountdown(remaining - days * DAY)}`;

  return (
    <div className={cn('flex flex-col', variant === 'hero' || variant === 'tv' ? 'items-center text-center' : 'items-start', className)}>
      <div
        role="timer"
        aria-live="off"
        aria-label={spoken ? `${label}: ${spoken}` : label}
        data-variant={variant}
        data-state={!ready ? 'unknown' : done ? 'zero' : 'running'}
        className={cn('tabular-nums text-highlight', SIZE[variant])}
      >
        <span aria-hidden="true">{digits}</span>
      </div>
      {caption ? <p className="text-body text-text-muted">{caption}</p> : null}
    </div>
  );
}
