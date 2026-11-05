'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import type { CelebrationType, EventStatus, Ms } from '@/lib/data/types';
import { formatClock, formatMidnightAgo } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { PostcardArt } from '@/components/windows/StampArt';
import s from './nowNext.module.css';

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
  /** Мініатюра трансляції (YouTube); немає — обкладинка країни з «Відлік» (правка власника 2026-11-05). */
  thumb?: string;
  /** Обкладинка країни (`PostcardArt`). */
  illustrationId?: string;
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
  /** Подія зараз у плеєрі ефіру (макет: «В ефірі» й «Наживо» ще до півночі). */
  onAir?: boolean;
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

/** C4. Картка події (макет `Main` / `Phone-Home-Live`): прапор і назва, час за часом глядача, статус трансляції. */
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
  thumb,
  illustrationId,
  status,
  onToggleSchedule,
  layout = 'carousel',
  onAir = false,
  className,
}: EventCardProps) {
  const t = useTranslations('liveCards.eventCard');
  const tBadge = useTranslations('primitives.badge');
  const tNav = useTranslations('nav');
  const tTime = useTranslations('primitives.time');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });

  const isPast = (status === 'ended' || status === 'recording') && !onAir;
  const isOnAir = status === 'live' || onAir;
  const typeLabel = t(`type.${TYPE_KEY[celebrationType]}`);
  const statusLabel = stream === 'live' ? typeLabel : tBadge(`status.${STATUS_KEY[stream]}`);
  const scheduleLabel = isPast
    ? t('schedulePast', { city: title })
    : inSchedule
      ? t('scheduleRemove', { city: title })
      : tNav('addToSchedule', { city: title });
  const scheduleInert = isPast || !onToggleSchedule;
  const icon: IconName = stream === 'live' && isOnAir ? 'broadcast-live' : STATUS_ICON[stream];
  const iconClass = stream === 'live' ? (isOnAir || !isPast ? s.iconLive : undefined) : stream === 'expected' ? s.iconExpected : undefined;

  return (
    <article data-event-card="" data-status={status} data-stream={stream} data-layout={layout} className={cn(s.card, className)}>
      <NextLink
        href={href}
        aria-current={isOnAir ? 'true' : undefined}
        className={cn('t2f-focus t2f-transition', s.link, isOnAir && s.onAir, isPast && s.past)}
      >
        {/* Мініатюра трансляції або обкладинка країни з «Відлік» — як картки трансляцій на сторінці країни. */}
        <span aria-hidden="true" className={cn(s.media, isPast && s.mediaPast)}>
          {thumb ? (
            // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" decoding="async" />
          ) : (
            <>
              <PostcardArt illustrationId={illustrationId ?? 'generic'} fill className={s.cover} />
              <span className={s.mediaTag}>
                <Icon name="clock" size={14} />
                {t('countdownTag')}
              </span>
            </>
          )}
        </span>
        <span className={s.top}>
          <Flag round code={flagCode} size="card" decorative className={isPast ? 'opacity-60' : undefined} />
          <span className={s.name}>
            {title}
            {countryName ? <span className="sr-only">{t('countryHint', { country: countryName })}</span> : null}
          </span>
          {/* «В ефірі» прибрано (правка власника 2026-11-05): є «Наживо» й червона смуга; для зчитувача — лишається. */}
          {isOnAir ? <span className="sr-only">{tBadge('onAir')}</span> : null}
        </span>

        <span className={s.mid}>
          <span className="sr-only">{t('midnight')}</span>
          <span className={s.timeRow}>
            <time dateTime={new Date(midnightMs).toISOString()} className={s.time}>
              {formatClock(midnightMs, { locale })}
            </time>
            {isOnAir ? <Badge variant="live" /> : null}
          </span>
          <span className={s.yours}>
            {isPast ? formatMidnightAgo(Math.max(0, now - midnightMs), locale) : tTime('yourTime')}
            {inSchedule ? <span className={s.inSchedule}>{t('inScheduleShort')}</span> : null}
            {isOwnMidnight ? <span className={s.inSchedule}>{tBadge('yourMidnight')}</span> : null}
          </span>
        </span>

        <span className={cn(s.status, stream === 'live' && !isPast && s.statusLive)}>
          <Icon name={icon} size={16} strokeWidth={2.2} className={iconClass} />
          <span>{statusLabel}</span>
        </span>
      </NextLink>

      <button
        type="button"
        aria-label={scheduleLabel}
        aria-pressed={inSchedule}
        disabled={scheduleInert}
        onClick={() => onToggleSchedule?.(id, !inSchedule)}
        className={cn('t2f-focus t2f-press rounded-full', s.cal)}
      >
        <span aria-hidden="true" className={s.calCircle}>
          <Icon name={inSchedule ? 'calendar-check' : 'calendar-add'} size={16} strokeWidth={inSchedule ? 2.2 : 2} />
        </span>
      </button>
    </article>
  );
}
