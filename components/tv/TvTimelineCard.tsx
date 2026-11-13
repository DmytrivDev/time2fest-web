'use client';

/**
 * TvTimelineCard (C22, дошка `TV-Party-New`): картка таймлайну режиму вечірки — НЕ плеєр.
 * Прапор, місто й календарик (у графіку — жовтий); час півночі за часом глядача й пояс поруч («02:00 UTC+0»);
 * унизу стан: «● Наживо · Вебкамера» / «Трансляція очікується» / «Лише відлік». Позначка «Програма» — що покаже
 * автопілот. Картка в ефірі — жовта рамка. OK: трансляція наживо — дивитися; майбутня подія — у графік / з графіка.
 */
import { useLocale, useTranslations } from 'next-intl';
import { isPastStatus } from '@/components/live/eventCards';
import type { EventCardStream } from '@/components/live/EventCard';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { formatAgo, formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import type { TvTimelineItem } from '@/lib/tv/tvData';
import styles from './tv.module.css';

/** Що робить OK на картці. */
export type TvCardAction = 'watch' | 'schedule-add' | 'schedule-remove' | 'none';

export interface TvTimelineCardProps {
  item: TvTimelineItem;
  /** Ця подія зараз на екрані. */
  onAir?: boolean;
  /** «Мій графік»: пояс поза графіком — приглушена. */
  dim?: boolean;
  /** Початковий фокус пульта. */
  initial?: boolean;
  action: TvCardAction;
  onActivate?: (item: TvTimelineItem) => void;
}

const STATUS_ICON: Record<EventCardStream, IconName> = {
  live: 'broadcast',
  expected: 'broadcast',
  possible: 'broadcast-dashed',
  'countdown-only': 'clock',
};
const STATUS_KEY = { expected: 'expected', possible: 'possible', 'countdown-only': 'countdownOnly' } as const;
const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;
const ACTION_KEY = { watch: 'cardWatch', 'schedule-add': 'cardAdd', 'schedule-remove': 'cardRemove' } as const;

export function TvTimelineCard({ item, onAir = false, dim = false, initial = false, action, onActivate }: TvTimelineCardProps) {
  const t = useTranslations('tv');
  const tType = useTranslations('liveCards.eventCard.type');
  const tBadge = useTranslations('primitives.badge');
  const locale = useLocale();
  const now = useNow({ granularity: 'minute' });
  const past = isPastStatus(item.status);
  const live = item.stream === 'live';

  let status;
  if (live) {
    status = (
      <>
        <Icon name="broadcast" size={18} className="text-primary" />
        <b className="text-primary">{tBadge('live')}</b>
        <span className="truncate text-text-secondary">· {tType(TYPE_KEY[item.celebrationType])}</span>
      </>
    );
  } else if (past) {
    status = (
      <>
        <Icon name="clock" size={18} className="text-text-muted" />
        <span className="text-text-secondary">
          <span className="sr-only">{t('cardPast')} </span>
          {now > 0 ? formatAgo(Math.max(0, now - item.midnightMs), locale) : null}
        </span>
      </>
    );
  } else {
    status = (
      <>
        <Icon name={STATUS_ICON[item.stream]} size={18} className={item.stream === 'countdown-only' ? 'text-text-muted' : 'text-text-secondary'} />
        <span className="truncate text-text-secondary">{tBadge(`status.${STATUS_KEY[item.stream as Exclude<EventCardStream, 'live'>]}`)}</span>
      </>
    );
  }

  return (
    <button
      type="button"
      aria-current={onAir ? 'true' : undefined}
      aria-disabled={action === 'none' ? true : undefined}
      data-tv-card=""
      data-status={item.status}
      data-stream={item.stream}
      data-program={item.program ? '' : undefined}
      data-dim={dim ? '' : undefined}
      {...(initial ? { 'data-tv-initial': '' } : {})}
      onClick={() => (action === 'none' ? undefined : onActivate?.(item))}
      className={cn('t2f-focus t2f-transition', styles.card)}
    >
      {item.program ? (
        <span className={styles.programTag}>
          <Icon name="play" size={12} />
          {t('programTag')}
        </span>
      ) : null}
      <span className="flex items-center gap-2">
        <Flag code={item.flagCode} size="md" decorative />
        <span className={cn('min-w-0 flex-1 truncate', styles.cardCity)}>
          {item.title}
          {item.countryName ? <span className="sr-only">, {item.countryName}</span> : null}
        </span>
        {past ? null : (
          <span role="img" aria-label={item.inSchedule ? t('cardSchedule') : t('cardNotSchedule')} className={styles.cardCal} data-on={item.inSchedule ? '' : undefined}>
            <Icon name={item.inSchedule ? 'calendar-check' : 'calendar'} size={18} />
          </span>
        )}
      </span>
      <span className={styles.cardMore}>
      <span className="flex items-baseline gap-2">
        <time dateTime={new Date(item.midnightMs).toISOString()} className={styles.cardTime}>
          {formatClock(item.midnightMs, { locale })}
        </time>
        <span className={styles.cardUtc}>{item.utc}</span>
      </span>
      <span className={styles.cardStatus}>{status}</span>
      </span>
      {action !== 'none' ? <span className="sr-only">. {t(ACTION_KEY[action])}</span> : null}
    </button>
  );
}
