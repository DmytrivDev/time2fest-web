'use client';

/**
 * TvQueueCard (C22): статична картка події в черзі «Далі» і в таймлайні ТВ — НЕ плеєр.
 * Прапор і назва, час півночі за часом глядача, статус трансляції: іконка + текст (текст читає й зчитувач),
 * «Відлік» замість «Наживо» для подій без трансляції; минулі події — «північ була 38 хв тому».
 * Картка — посилання на сторінку країни (OK відкриває її, як картка події на головній).
 * Текст не менший за 22 px (`text-tv-text`), фокус — контур 4 px (`data-surface="tv"`).
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { isPastStatus, type EventCardItem } from '@/components/live/eventCards';
import type { EventCardStream } from '@/components/live/EventCard';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { formatAgo, formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import styles from './tv.module.css';

export interface TvQueueCardProps {
  item: EventCardItem;
  /** Це подія, що йде в ефірі зараз (таймлайн). */
  onAir?: boolean;
  /** Фіксована ширина слайда (таймлайн) замість повної ширини (черга). */
  layout?: 'queue' | 'strip';
  /** Початковий фокус ТВ (перша картка черги). */
  initial?: boolean;
  className?: string;
}

const STATUS_ICON: Record<EventCardStream, IconName> = {
  live: 'broadcast',
  expected: 'broadcast',
  possible: 'broadcast-dashed',
  'countdown-only': 'clock',
};

const STATUS_KEY = { expected: 'expected', possible: 'possible', 'countdown-only': 'countdownOnly' } as const;
const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;

export function TvQueueCard({ item, onAir = false, layout = 'queue', initial = false, className }: TvQueueCardProps) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const tCard = useTranslations('liveCards.eventCard');
  const tc = useTranslations('common');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });

  const past = isPastStatus(item.status);
  const typeLabel = tType(TYPE_KEY[item.celebrationType]);
  const statusLabel = item.stream === 'live' ? typeLabel : tBadge(`status.${STATUS_KEY[item.stream]}`);
  const time = formatClock(item.midnightMs, { locale });

  return (
    <NextLink
      href={item.href}
      aria-current={onAir ? 'true' : undefined}
      data-tv-card=""
      data-status={item.status}
      data-stream={item.stream}
      {...(initial ? { 'data-tv-initial': '' } : {})}
      className={cn(
        't2f-focus t2f-transition relative flex flex-col gap-1.5 rounded-lg px-5 text-text no-underline',
        layout === 'strip' ? styles.stripCard : 'w-full py-3.5',
        onAir ? 'border-s-4 border-s-primary bg-surface-raised' : 'bg-surface hover:bg-surface-raised',
        past && 'text-text-secondary',
        className,
      )}
    >
      <span className="flex min-h-8 items-center gap-3 pe-10">
        <Flag code={item.flagCode} size="md" decorative />
        <span className={cn('min-w-0 truncate text-tv-title', past && 'text-text-secondary')}>
          {item.title}
          {item.countryName ? <span className="sr-only">{tCard('countryHint', { country: item.countryName })}</span> : null}
        </span>
      </span>
      {item.inSchedule ? (
        <span role="img" aria-label={t('cardSchedule')} className={styles.scheduleMark}>
          <Icon name="calendar-check" size={22} />
        </span>
      ) : null}

      <span className="flex flex-col">
        <span className="sr-only">{tCard('midnight')}</span>
        <span className="flex items-center gap-3">
          <time dateTime={new Date(item.midnightMs).toISOString()} className="text-headline-lg tabular-nums">
            {time}
          </time>
          {onAir ? <Badge variant="live" size="tv" /> : null}
        </span>
        <span className="text-tv-text text-text-secondary">
          {past ? (
            <>
              <span className="sr-only">{t('cardPast')} </span>
              {now > 0 ? formatAgo(Math.max(0, now - item.midnightMs), locale) : null}
            </>
          ) : (
            tc('yourTime')
          )}
        </span>
      </span>

      <span className={cn('flex min-h-8 items-center gap-2.5 text-tv-text', item.stream === 'countdown-only' || item.stream === 'possible' ? 'text-text-secondary' : 'text-text')}>
        <Icon name={STATUS_ICON[item.stream]} size={22} />
        <span className="min-w-0">{statusLabel}</span>
      </span>
    </NextLink>
  );
}
