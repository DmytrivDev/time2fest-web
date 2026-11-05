'use client';

/**
 * Календарик «Додати в графік» — той самий вигляд і стани, що на картках «Зараз і далі» (правка власника 2026-11-05):
 * у графіку — жовтий з галочкою, натиск прибирає; північ минула або до неї менше 2 хв — неактивний з підказкою
 * («Північ уже минула» / «До півночі менше 2 хвилин…»), а якщо подія була в графіку — жовтий, але тьмяний.
 */
import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { Tooltip } from '@/components/primitives/Tooltip';
import s from './nowNext.module.css';

/** За скільки до півночі додати в графік уже не можна. */
export const SCHEDULE_CLOSE_MS = 2 * 60_000;

export interface CalendarButtonProps {
  /** Місто для назви кнопки («Додати в графік: Париж»). */
  city: string;
  inSchedule: boolean;
  /** Чому додати вже не можна; `null` — можна. */
  closed: 'past' | 'soon' | null;
  onToggle?: () => void;
  className?: string;
}

export function scheduleClosed(midnightMs: number, now: number): 'past' | 'soon' | null {
  if (now >= midnightMs) return 'past';
  return midnightMs - now < SCHEDULE_CLOSE_MS ? 'soon' : null;
}

export function CalendarButton({ city, inSchedule, closed, onToggle, className }: CalendarButtonProps) {
  const t = useTranslations('liveCards.eventCard');
  const tNav = useTranslations('nav');
  const icon = (
    <Icon name={inSchedule ? 'calendar-check' : 'calendar-add'} size={16} strokeWidth={inSchedule ? 2.2 : 2} />
  );
  if (closed) {
    const why = closed === 'past' ? t('scheduleClosedPast') : t('scheduleClosedSoon');
    return (
      <Tooltip content={why}>
        {/* `aria-disabled`, а не `disabled`: неактивна кнопка без наведення лишилася б без підказки. */}
        <button
          type="button"
          aria-disabled="true"
          aria-pressed={inSchedule}
          aria-label={`${inSchedule ? t('scheduleRemove', { city }) : tNav('addToSchedule', { city })}. ${why}`}
          className={cn('t2f-focus rounded-full', s.cal, s.calClosed, className)}
        >
          <span aria-hidden="true" className={cn(s.calCircle, inSchedule && s.calWasOn)}>
            {icon}
          </span>
        </button>
      </Tooltip>
    );
  }
  return (
    <button
      type="button"
      aria-label={inSchedule ? t('scheduleRemove', { city }) : tNav('addToSchedule', { city })}
      aria-pressed={inSchedule}
      disabled={!onToggle}
      onClick={onToggle}
      className={cn('t2f-focus t2f-press rounded-full', s.cal, className)}
    >
      <span aria-hidden="true" className={s.calCircle}>
        {icon}
      </span>
    </button>
  );
}
