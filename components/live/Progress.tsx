'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { ProgressBar } from '@/components/primitives/ProgressBar';

export interface FestProgressProps {
  hoursPassed: number;
  hoursTotal: number;
  zonesDone: number;
  zonesTotal: number;
  /** Підписи країв смужки: «12:00 · Кірибаті» і «14:00 · 1 січня» (за вашим часом). */
  startLabel?: string;
  endLabel?: string;
  className?: string;
}

/** C5 (частина). «Прогрес свята»: «Минуло 13 год із 26 · Новий рік зустріли 23 пояси з 38». Таймерів немає. */
export function FestProgress({ hoursPassed, hoursTotal, zonesDone, zonesTotal, startLabel, endLabel, className }: FestProgressProps) {
  const t = useTranslations('nav');
  const values = { hours: hoursPassed, total: hoursTotal, zones: zonesDone, zonesTotal };
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <p aria-hidden="true" className="text-caption font-semibold text-text-secondary">
        {t('progressTitle')}
      </p>
      {startLabel || endLabel ? (
        <p aria-hidden="true" className="flex justify-between gap-3 text-label-badge-chat tabular-nums text-text-muted">
          <span>{startLabel}</span>
          <span>{endLabel}</span>
        </p>
      ) : null}
      <ProgressBar
        value={hoursPassed}
        max={hoursTotal}
        label={t('progressTitle')}
        valueText={t('progressSpoken', values)}
        caption={t('progressCaption', values)}
      />
    </div>
  );
}
