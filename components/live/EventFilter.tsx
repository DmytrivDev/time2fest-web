'use client';

/**
 * Фільтр «Усі · З трансляціями · Мій графік» — один компонент для «Зараз і далі» на головній і для сторінки «Країни й міста»
 * (правка власника 2026-11-04): ті самі сегменти, іконки й лічильник графіка; що саме він звужує — вирішує сторінка.
 * Без пасу «Мій графік» — із замком (пояснення показує сторінка). Іконки — однаково на телефоні й десктопі (правка
 * власника 2026-11-05: «З трансляціями» з іконкою скрізь).
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
  /** Назва групи для зчитувача (за замовчуванням — як у «Зараз і далі»). */
  label?: string;
  className?: string;
  /** Без «З трансляціями» (кімната перегляду: там і так лише поточні трансляції). */
  hideLive?: boolean;
}

export function EventFilter({
  value,
  onValueChange,
  scheduleLocked = false,
  scheduleCount = 0,
  label,
  hideLive = false,
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
      className={cn(s.filter, className)}
    >
      <ToggleGroup.Item value="all" className={cn('t2f-focus', s.seg)}>
        {t('filterAll')}
      </ToggleGroup.Item>
      {hideLive ? null : (
        <ToggleGroup.Item value="live" className={cn('t2f-focus', s.seg)}>
          <Icon name="broadcast" size={14} />
          {t('filterLive')}
        </ToggleGroup.Item>
      )}
      <ToggleGroup.Item
        value="mine"
        aria-label={lockedHint ? `${t('filterMine')}. ${lockedHint}` : undefined}
        data-locked={scheduleLocked || undefined}
        className={cn('t2f-focus', s.seg)}
      >
        <Icon name={scheduleLocked ? 'lock' : 'calendar-check'} size={14} />
        {t('filterMine')}
        {!scheduleLocked && scheduleCount > 0 ? <span className={s.segCount}>{scheduleCount}</span> : null}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );
}
