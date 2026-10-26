'use client';

/**
 * Підпис під плеєром (C1: CaptionRow1–3) — три рядки за фазою з `lib/engine/captionPhase`:
 * 1) позначка «Наживо» + таймер («до півночі 00:22:15» / «далі через 0:59»; після моменту таймера немає);
 * 2) назва події-посилання «Лондон · Біг-Бен ›» (на сторінку країни);
 * 3) «Велика Британія · північ о 02:00 за вашим часом» → «Велика Британія зустріла Новий рік» (`metPhrase`, рід країни)
 *    → «Далі: Азорські острови».
 * Нових смуг між фазами немає: змінюються лише таймер і рядок 3. Назви — лише в називному відмінку.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/primitives/Badge';
import { cn } from '@/components/primitives/cn';
import type { City, Country, Ms } from '@/lib/data/types';
import type { CaptionMode, CaptionPhase } from '@/lib/engine/captionPhase';
import { joinNamesUk, metPhrase } from '@/lib/engine/metPhrase';
import { formatAgo, formatClock, formatCountdown, formatShortCountdown } from '@/lib/i18n/time';
import styles from './live.module.css';

export interface CaptionPlace {
  /** Північ події, мс epoch UTC. */
  midnightMs: Ms;
  city: Pick<City, 'name' | 'landmark'> | undefined;
  country: Pick<Country, 'name' | 'gender'> | undefined;
  /** Сторінка країни. */
  href: string | null;
}

export interface CaptionProps {
  phase: CaptionPhase;
  current: CaptionPlace;
  next?: CaptionPlace | null;
  /** Позначка «Наживо» (є відео в ефірі). */
  live?: boolean;
  /** «Перевірено» (десктоп): джерело перевірене власником. */
  verified?: boolean;
  /** Часовий пояс глядача (тести, історії); типово — пояс браузера. */
  timeZone?: string;
  /** id заголовка блоку плеєра (сюди повертається фокус після закриття вікон). */
  titleId?: string;
  /**
   * `remote` — сторінка країни (пульт): сама не переходить; після півночі «Запис» і «північ була 40 хв тому»
   * на місці таймера, рядок 3 — «Франція зустріла Новий рік · далі: Велика Британія о 02:00».
   */
  mode?: CaptionMode;
  /** Назва рядка 2 замість «Місто · пам’ятка» (пульт: назва вибраної трансляції). */
  title?: string;
  className?: string;
}

/** «Лондон · Біг-Бен» або просто «Азорські острови». */
export function eventTitle(city: CaptionPlace['city']): string {
  if (!city) return '';
  return city.landmark?.uk ? `${city.name.uk} · ${city.landmark.uk}` : city.name.uk;
}

function useSpoken() {
  const t = useTranslations('primitives.countdown');
  const tp = useTranslations('player');
  return (ms: number) => {
    const totalSec = Math.max(0, Math.ceil(ms / 1_000));
    if (totalSec === 0) return t('spokenZero');
    // Остання хвилина — секундами; далі — до хвилини вгору (зчитувач не читає щосекунди: `role="timer"` без live).
    if (totalSec < 60) return tp('secondsSpoken', { seconds: totalSec });
    const totalMinutes = Math.ceil(totalSec / 60);
    return t('spoken', {
      days: Math.floor(totalMinutes / 1440),
      hours: Math.floor((totalMinutes % 1440) / 60),
      minutes: totalMinutes % 60,
    });
  };
}

export function Caption({
  phase,
  current,
  next,
  live = false,
  verified = false,
  timeZone,
  titleId,
  mode = 'broadcast',
  title: titleProp,
  className,
}: CaptionProps) {
  const t = useTranslations('player');
  const tc = useTranslations('country.caption');
  const tMet = useTranslations('met');
  const tBadge = useTranslations('primitives.badge');
  const spoken = useSpoken();

  const r1 = phase.row1Right;
  const timer =
    r1.kind === 'countdown' || r1.kind === 'handover'
      ? {
          label: r1.kind === 'countdown' ? t('timerUntil') : t('timerNext'),
          digits: r1.kind === 'countdown' ? formatCountdown(r1.ms) : formatShortCountdown(r1.ms),
          ms: r1.ms,
        }
      : null;

  const ago = r1.kind === 'ago' ? r1.ms : null;
  const tzOpts = timeZone ? { timeZone } : {};

  const countryName = current.country?.name.uk ?? '';
  let row3: string;
  switch (phase.row3.kind) {
    case 'midnight-at':
      row3 = t('lineBefore', { country: countryName, time: formatClock(current.midnightMs, tzOpts) });
      break;
    case 'met':
    case 'met-and-next': {
      if (!current.country) {
        row3 = '';
        break;
      }
      const p = metPhrase(current.country);
      row3 = p.kind === 'single' ? tMet('single', p.params) : p.kind === 'multi' ? tMet('multi', { names: joinNamesUk(p.params.names) }) : tMet('fallback', p.params);
      if (phase.row3.kind === 'met-and-next' && next) {
        const place = next.country?.name.uk ?? next.city?.name.uk ?? '';
        row3 = tc('metAndNext', { met: row3, place, time: formatClock(next.midnightMs, tzOpts) });
      }
      break;
    }
    case 'next':
      row3 = t('lineNext', { place: next?.city?.name.uk ?? '' });
      break;
  }

  const title = titleProp ?? eventTitle(current.city);
  // Пульт: ми вже на сторінці країни — назва не посилання.
  const href = mode === 'remote' ? null : current.href;

  return (
    <div data-caption="" data-phase={phase.id} className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {live && ago === null ? <Badge variant="live">{tBadge('live')}</Badge> : null}
        {ago !== null ? (
          <span data-caption-recording="" className="inline-flex">
            <Badge variant="recording">{tc('recording')}</Badge>
          </span>
        ) : null}
        {verified ? (
          <span className={cn(styles.deskOnly, 'items-center gap-1 text-caption text-text-muted')}>
            {tBadge('verified')}
          </span>
        ) : null}
        {phase.flags.delayNotice ? <span className="text-caption text-text-muted">{t('delayNote')}</span> : null}
        {timer ? (
          <span
            role="timer"
            aria-live="off"
            aria-label={`${timer.label}: ${spoken(timer.ms)}`}
            data-caption-timer={r1.kind}
            className="ms-auto inline-flex items-baseline gap-2 whitespace-nowrap"
          >
            <span aria-hidden="true" className="text-caption text-text-muted">
              {timer.label}
            </span>{' '}
            <span aria-hidden="true" className="text-countdown-inline tabular-nums text-highlight">
              {timer.digits}
            </span>
          </span>
        ) : null}
        {ago !== null ? (
          <span data-caption-ago="" className="ms-auto whitespace-nowrap text-caption text-text-muted">
            {tc('ago', { ago: formatAgo(ago) })}
          </span>
        ) : null}
      </div>
      <h2 id={titleId} tabIndex={-1} className="text-headline-sm text-text focus:outline-none">
        {href ? (
          <NextLink href={href} className="t2f-focus t2f-transition rounded-sm hover:text-text-secondary">
            {title}
            <span aria-hidden="true" className="text-text-secondary">
              {' ›'}
            </span>
          </NextLink>
        ) : (
          title
        )}
      </h2>
      <p
        data-caption-row3={phase.row3.kind}
        role={phase.row3.kind === 'next' ? 'status' : undefined}
        className="-mt-1 text-caption text-text-muted"
      >
        {row3}
      </p>
    </div>
  );
}
