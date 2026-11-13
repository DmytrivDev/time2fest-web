'use client';

/**
 * Картка країни поясу в «Моєму графіку» (рішення власника 2026-11-06, дошка `Desk-Schedule-New` v4) — та сама, що
 * «Обрати трансляцію» / «Поточні трансляції» (`streamPicker.module.css` → `.pickCard`): рамка; угорі мініатюра 112 × 63
 * («▶», якщо трансляція є; інакше заглушка зі значком) і праворуч назва країни до двох рядків, круглий прапор із містом;
 * унизу — стан і круглий календарик (порожній — додати, жовтий — у графіку). Клік по картці — сторінка країни.
 * `adding` — «Додаєш» у вікні заміни: без календарика.
 */
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import { CalendarButton } from '@/components/live/CalendarButton';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { thumbOf } from '@/lib/live/thumb';
import type { ScheduleCountry } from '@/lib/schedule/scheduleCountry';
import s from '@/components/live/streamPicker.module.css';
import sc from './schedule.module.css';

const KIND_KEY = { main: 'main', webcam: 'webcam', tv: 'tv' } as const;

export function ScheduleCountryCard({
  c,
  inSchedule,
  closed,
  adding = false,
  onToggle,
}: {
  c: ScheduleCountry;
  inSchedule: boolean;
  closed: 'past' | 'soon' | null;
  adding?: boolean;
  onToggle?: () => void;
}) {
  const t = useTranslations('schedulePage.zone');
  const tType = useTranslations('liveCards.eventCard.type');
  const thumb = c.row && (c.group === 'live' || c.group === 'webcam') ? thumbOf(c.row) : undefined;
  const label =
    c.group === 'live' && c.row
      ? t('liveKind', { kind: tType(KIND_KEY[c.row.kind]) })
      : c.group === 'main'
        ? t('expectedMain')
        : c.group === 'webcam'
          ? tType('webcam')
          : tType('countdownOnly');
  return (
    <li className={cn(s.pickCard, !adding && inSchedule && s.pickCardOn)} data-schedule-country={c.iso} data-group={c.group}>
      <NextLink href={c.href} className={cn('t2f-focus t2f-transition', s.pickMain, sc.cardLink)}>
        <span aria-hidden="true" className={s.thumb}>
          {thumb ? (
            // Мініатюра YouTube: зовнішня адреса, next/image без оптимізації тут зайвий.
            // eslint-disable-next-line @next/next/no-img-element
            <img src={thumb} alt="" loading="lazy" decoding="async" />
          ) : (
            <span className={sc.thumbIcon}>
              <Icon name={c.group === 'countdown' ? 'clock' : 'broadcast'} size={20} />
            </span>
          )}
          {thumb ? (
            <span className={s.playBtn}>
              <Icon name="play" size={16} />
            </span>
          ) : null}
        </span>
        <span className={s.text}>
          <span className={s.titleText}>{c.name}</span>
          <span className={s.sub}>
            <Flag code={c.flagCode} size="xs" decorative />
            <span className={s.subText}>{c.place}</span>
          </span>
        </span>
      </NextLink>
      <div className={s.pickFoot}>
        <span className={s.live}>
          <Icon
            name={c.group === 'live' ? 'broadcast-live' : c.group === 'countdown' ? 'clock' : 'broadcast'}
            size={16}
            className={c.group === 'live' ? 'text-primary' : 'text-text-secondary'}
          />
          {label}
        </span>
        {adding ? null : (
          <span className={s.pickBtns}>
            <CalendarButton city={c.name} inSchedule={inSchedule} closed={closed} onToggle={onToggle} className={s.pickCal} />
          </span>
        )}
      </div>
    </li>
  );
}
