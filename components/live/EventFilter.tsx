'use client';

/**
 * Фільтр «Усі · З трансляціями · Мій графік» — один компонент для «Зараз і далі» на головній і для сторінки «Країни й міста»
 * (правка власника 2026-11-04): ті самі сегменти, іконки й лічильник графіка; що саме він звужує — вирішує сторінка.
 * Без пасу «Мій графік» — із замком (пояснення показує сторінка). `stack` — телефон: іконок немає, лише замок.
 */
import { useTranslations } from 'next-intl';
import { ToggleGroup } from 'radix-ui';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import s from './nowNext.module.css';

export type EventFilterValue = 'all' | 'live' | 'mine';

export interface EventFilterProps {
  value: EventFilterValue;
  onValueChange: (next: EventFilterValue) => void;
  /** Без пасу: «Мій графік» із замком. */
  scheduleLocked?: boolean;
  /** Скільки подій у графіку (лічильник біля «Мій графік»); 0 — без лічильника. */
  scheduleCount?: number;
  /** Телефон: без іконок (окрім замка). */
  stack?: boolean;
  /** Те саме, але за шириною екрана через CSS (вигляд правильний ще до завантаження скриптів). */
  responsive?: boolean;
  /** Назва групи для зчитувача (за замовчуванням — як у «Зараз і далі»). */
  label?: string;
  className?: string;
}

export function EventFilter({
  value,
  onValueChange,
  scheduleLocked = false,
  scheduleCount = 0,
  stack = false,
  responsive = false,
  label,
  className,
}: EventFilterProps) {
  const t = useTranslations('liveCards.nowNext');
  const lockedHint = scheduleLocked ? t('mineLocked') : undefined;
  return (
    <ToggleGroup.Root
      type="single"
      aria-label={label ?? t('filterLabel')}
      value={value}
      onValueChange={(v) => {
        if (v) onValueChange(v as EventFilterValue);
      }}
      data-row="filter"
      className={cn(s.filter, responsive && s.filterResponsive, className)}
    >
      <ToggleGroup.Item value="all" className={cn('t2f-focus', s.seg)}>
        {t('filterAll')}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="live" className={cn('t2f-focus', s.seg)}>
        {stack ? null : <Icon name="broadcast" size={14} className={s.segIcon} />}
        {t('filterLive')}
      </ToggleGroup.Item>
      <ToggleGroup.Item
        value="mine"
        aria-label={lockedHint ? `${t('filterMine')}. ${lockedHint}` : undefined}
        data-locked={scheduleLocked || undefined}
        className={cn('t2f-focus', s.seg)}
      >
        {stack ? null : (
          <Icon name={scheduleLocked ? 'lock' : 'calendar-check'} size={14} className={scheduleLocked ? undefined : s.segIcon} />
        )}
        {stack && scheduleLocked ? <Icon name="lock" size={14} /> : null}
        {t('filterMine')}
        {!scheduleLocked && scheduleCount > 0 ? <span className={s.segCount}>{scheduleCount}</span> : null}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
