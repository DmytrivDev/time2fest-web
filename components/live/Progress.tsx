'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { useId } from 'react';
import s from './nowNext.module.css';

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

/**
 * C5 (частина). «Прогрес свята» за макетом: підпис, краї «12:00 · Кірибаті» / «14:00 · 1 січня» (над смужкою — і на
 * десктопі, щоб підказка їх не перекривала), смужка 6 px з повзунком і постійною підказкою під ним «Минуло 13 год із 26 ·
 * Новий рік зустріли 23 пояси з 38», що не виходить за краї блоку. Таймерів немає.
 */
export function FestProgress({ hoursPassed, hoursTotal, zonesDone, zonesTotal, startLabel, endLabel, className }: FestProgressProps) {
  const t = useTranslations('nav');
  const id = useId();
  const values = { hours: hoursPassed, total: hoursTotal, zones: zonesDone, zonesTotal };
  const pct = hoursTotal > 0 ? Math.max(0, Math.min(100, (hoursPassed / hoursTotal) * 100)) : 0;
  // Підказка не виходить за краї блоку: її лівий край іде за повзунком, а сама зсувається на ту саму частку своєї ширини.
  const tipStyle = { left: `${pct}%`, transform: `translateX(-${pct}%)` };
  const arrowLeft = `clamp(10px, ${pct}%, calc(100% - 10px))`;
  return (
    <div className={cn(s.progress, className)} data-fest-progress="">
      <div className={s.progressLabel}>
        <span id={`${id}-label`}>{t('progressTitle')}</span>
      </div>
      <div className={s.progressBody}>
        {startLabel || endLabel ? (
          <p aria-hidden="true" className={s.progressEdges}>
            <span>{startLabel}</span>
            <span>{endLabel}</span>
          </p>
        ) : null}
        <div
          role="progressbar"
          tabIndex={0}
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-tip`}
          aria-valuemin={0}
          aria-valuemax={hoursTotal}
          aria-valuenow={hoursPassed}
          aria-valuetext={t('progressSpoken', values)}
          className={cn('t2f-focus', s.bar)}
        >
          <span aria-hidden="true" className={s.fill} style={{ width: `${pct}%` }} />
          <span aria-hidden="true" className={s.thumb} style={{ left: `${pct}%` }} />
        </div>
      </div>
      <span aria-hidden="true" className={s.tipArrow} style={{ left: arrowLeft }} />
      <div role="tooltip" id={`${id}-tip`} className={s.tip} style={tipStyle}>
        <span className={s.tipStrong}>{t('progressHours', values)}</span>
        <span className={s.tipRest}>
          <span className="max-md:hidden"> · </span>
          {t('progressZones', values)}
        </span>
      </div>
    </div>
  );
}
