'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { TimeText } from '@/components/primitives/TimeText';
import type { CelebrationType, EventStatus, Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';

/** Стан трансляції події для рядка статусу картки (чотири статуси — `Badge stream-status`). */
export type EventCardStream = 'live' | 'expected' | 'possible' | 'countdown-only';

/** Дані картки: усе, що потрібно показати; без відліку (він один на сторінці — ІНВ C4). */
export interface EventCardData {
  id: string;
  /** Місто чи «Париж · Берлін · Рим». Без відмінювання. */
  title: string;
  /** Країна для зчитувача (поруч із назвою міста). */
  countryName?: string;
  flagCode: string;
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  celebrationType: CelebrationType;
  stream: EventCardStream;
  /** Сторінка країни. */
  href: string;
  inSchedule?: boolean;
  /** Це північ глядача («ваша північ»). */
  isOwnMidnight?: boolean;
}

export interface EventCardProps extends EventCardData {
  /** `eventStatus(now, event)`: soon → live → ended → recording. */
  status: EventStatus;
  /**
   * Кнопка графіка. Без обробника вона інертна (неактивна): графік з’являється в US5.
   * Минулим подіям кнопка завжди неактивна.
   */
  onToggleSchedule?: (id: string, next: boolean) => void;
  /** `carousel` — фіксована ширина слайда · `stack` — на всю ширину (телефон). */
  layout?: 'carousel' | 'stack';
  className?: string;
}

const TYPE_KEY: Record<CelebrationType, 'main' | 'webcam' | 'tv' | 'countdownOnly'> = {
  main: 'main',
  webcam: 'webcam',
  tv: 'tv',
  'countdown-only': 'countdownOnly',
};

const STATUS_KEY: Record<Exclude<EventCardStream, 'live'>, 'expected' | 'possible' | 'countdownOnly'> = {
  expected: 'expected',
  possible: 'possible',
  'countdown-only': 'countdownOnly',
};

const STATUS_ICON: Record<EventCardStream, IconName> = {
  live: 'broadcast',
  expected: 'broadcast',
  possible: 'broadcast-dashed',
  'countdown-only': 'clock',
};

/** C4. Картка події: прапор і назва, час за часом глядача, статус трансляції. Веде на сторінку країни. */
export function EventCard({
  id,
  title,
  countryName,
  flagCode,
  midnightMs,
  celebrationType,
  stream,
  href,
  inSchedule = false,
  isOwnMidnight = false,
  status,
  onToggleSchedule,
  layout = 'carousel',
  className,
}: EventCardProps) {
  const t = useTranslations('liveCards.eventCard');
  const tBadge = useTranslations('primitives.badge');
  const tNav = useTranslations('nav');
  const locale = useLocale();

  const isOnAir = status === 'live';
  const isPast = status === 'ended' || status === 'recording';
  const typeLabel = t(`type.${TYPE_KEY[celebrationType]}`);
  const statusLabel = stream === 'live' ? typeLabel : tBadge(`status.${STATUS_KEY[stream]}`);
  const scheduleLabel = isPast
    ? t('schedulePast', { city: title })
    : inSchedule
      ? t('scheduleRemove', { city: title })
      : tNav('addToSchedule', { city: title });
  const scheduleInert = isPast || !onToggleSchedule;
  const extras = inSchedule || isOwnMidnight;

  return (
    <article
      data-event-card=""
      data-status={status}
      data-stream={stream}
      data-layout={layout}
      className={cn('relative', layout === 'carousel' ? 'w-58' : 'w-full', className)}
    >
      <NextLink
        href={href}
        aria-current={isOnAir ? 'true' : undefined}
        className={cn(
          't2f-focus t2f-transition flex min-h-35 flex-col justify-between gap-2 rounded-md border py-3.5 pe-4 no-underline',
          isOnAir
            ? 'border-border-strong border-s-4 border-s-primary bg-surface-raised ps-3 text-text'
            : 'border-transparent bg-surface ps-4 hover:bg-surface-raised',
          isPast ? 'text-text-muted' : 'text-text',
        )}
      >
        <span className="flex min-h-touch-min items-center gap-2 pe-12">
          <Flag code={flagCode} size="sm" decorative className={isPast ? 'opacity-60' : undefined} />
          <span className="min-w-0 truncate text-headline-sm">
            {title}
            {countryName ? <span className="sr-only">{t('countryHint', { country: countryName })}</span> : null}
          </span>
          {isOnAir ? <Badge variant="on-air" className="shrink-0" /> : null}
        </span>

        <span className="flex flex-col gap-1.5">
          <span className="sr-only">{t('midnight')}</span>
          {isPast ? (
            <span className="inline-flex flex-col">
              <time dateTime={new Date(midnightMs).toISOString()} className="text-countdown-card tabular-nums">
                {formatClock(midnightMs, { locale })}
              </time>
              <TimeText at={midnightMs} variant="relative" midnight />
            </span>
          ) : (
            <span className="flex items-start gap-2.5">
              <TimeText at={midnightMs} variant="card" />
              {isOnAir ? <Badge variant="live" className="mt-1" /> : null}
            </span>
          )}

          <span
            className={cn(
              'flex min-h-5 items-center gap-1.5 text-caption font-medium',
              stream === 'live' && !isPast ? 'text-text' : 'text-text-secondary',
            )}
          >
            <Icon name={STATUS_ICON[stream]} size={16} />
            <span className="min-w-0 truncate">{statusLabel}</span>
          </span>

          {extras ? (
            <span className="flex flex-wrap gap-1.5">
              {inSchedule ? <Badge variant="in-schedule" /> : null}
              {isOwnMidnight ? <Badge variant="your-midnight" /> : null}
            </span>
          ) : null}
        </span>
      </NextLink>

      <IconButton
        variant="toggle"
        compact
        icon={inSchedule ? 'calendar-check' : 'calendar-add'}
        aria-label={scheduleLabel}
        pressed={inSchedule}
        disabled={scheduleInert}
        onPressedChange={(next) => onToggleSchedule?.(id, next)}
        className="absolute end-1 top-1"
      />
    </article>
  );
}
