'use client';

import { useLocale, useTranslations } from 'next-intl';
import { formatAgo, formatMidnightAgo, formatTimeForViewer } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { cn } from './cn';
import { Tooltip } from './Tooltip';

export type TimeTextVariant = 'card' | 'inline' | 'relative';

export interface TimeTextProps {
  /** Момент події: мс epoch UTC або ISO. */
  at: number | string;
  /**
   * `card` — «03:00» 28 px + «за вашим часом» ·
   * `inline` — «03:00 за вашим часом» (з датою, якщо інший день) ·
   * `relative` — «38 хв тому» / «через 2 год»; з `midnight` — «північ була 38 хв тому».
   */
  variant?: TimeTextVariant;
  /** Часовий пояс глядача (IANA); за замовчуванням — пристрою. */
  timeZone?: string;
  /** Мова форматування (за замовчуванням — мова інтерфейсу; 12/24 год визначає `Intl`). */
  locale?: string;
  /** Для `relative`: підписати «північ була …». */
  midnight?: boolean;
  /** UTC лише в підказці (ІНВ: UTC ніколи не на першому плані). */
  utcHint?: boolean;
  className?: string;
}

/** P25. Час події за часом глядача (форматування — `lib/i18n/time.ts`). */
export function TimeText({ at, variant = 'inline', timeZone, locale, midnight = false, utcHint = false, className }: TimeTextProps) {
  const uiLocale = useLocale();
  const t = useTranslations('primitives.time');
  const now = useNow({ granularity: 'minute' });
  const loc = locale ?? uiLocale;
  const ms = typeof at === 'number' ? at : Date.parse(at);
  // До гідратації «зараз» невідоме (0): день не порівнюємо, показуємо лише час.
  const v = formatTimeForViewer(ms, { now: now > 0 ? now : ms, locale: loc, timeZone });
  const iso = new Date(ms).toISOString();

  let body;
  if (variant === 'relative') {
    const diff = ms - now;
    let text: string;
    if (now === 0) text = v.time;
    else if (diff <= 0) text = midnight ? formatMidnightAgo(-diff, loc) : formatAgo(-diff, loc);
    else text = new Intl.RelativeTimeFormat(loc, { numeric: 'always', style: 'short' }).format(Math.max(1, Math.round(diff / 60_000)), 'minute');
    body = (
      <time dateTime={iso} className={cn('text-body text-text-secondary', className)}>
        {text}
      </time>
    );
  } else if (variant === 'card') {
    body = (
      <span className={cn('inline-flex flex-col', className)}>
        <time dateTime={iso} className="text-countdown-card tabular-nums text-text">
          {v.time}
        </time>
        <span className="text-caption text-text-secondary">
          {v.date ? `${v.date} · ` : ''}
          {t('yourTime')}
        </span>
      </span>
    );
  } else {
    body = (
      <span className={cn('text-body text-text', className)}>
        <time dateTime={iso} className="tabular-nums">
          {v.date ? `${v.date}, ` : ''}
          {v.time}
        </time>{' '}
        <span className="text-text-secondary">{t('yourTime')}</span>
      </span>
    );
  }

  if (!utcHint) return body;
  return (
    <Tooltip content={v.utcHint}>
      <button type="button" className="t2f-focus cursor-help rounded-sm text-start">
        {body}
      </button>
    </Tooltip>
  );
}
