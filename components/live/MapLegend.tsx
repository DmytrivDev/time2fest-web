'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { ZoneState } from '@/lib/engine/zoneState';
import './ZoneMap.css';

export interface MapLegendProps {
  /**
   * `grid` — 2 колонки (список поясів) · `column` — колонка праворуч від мапи · `inMap` — телефон, у рамці мапи під нею:
   * 3 колонки, 12 px, короткі підписи (дошка `Phone-Map-Legend`, варіант A) · `row` — десктоп, рядком під мапою в її
   * рамці (дошка `Desk-Home-MapWidths`).
   */
  variant?: 'grid' | 'column' | 'inMap' | 'row';
  className?: string;
}

// Порядок — як іде ніч (дошка `Desk-Map-Legend`, телефон A): наживо, найближча, попереду, вже зустріли.
const STATES: readonly { state: ZoneState; sw: 'past' | 'live' | 'next' | 'ahead' }[] = [
  { state: 'live', sw: 'live' },
  { state: 'next', sw: 'next' },
  { state: 'future', sw: 'ahead' },
  { state: 'past', sw: 'past' },
];

/**
 * C18 `MapLegend`: чотири стани поясу (зразок + підпис) і два види точок міст — коротко, спершу «Місто», потім
 * «Трансляція» (правка власника 2026-11-03). На десктопі — рядком під мапою (рішення власника 2026-11-04).
 */
export function MapLegend({ variant = 'grid', className }: MapLegendProps) {
  const column = variant === 'column';
  const inMap = variant === 'inMap';
  const row = variant === 'row';
  const t = useTranslations('liveMap.legend');
  const tNav = useTranslations('nav');
  return (
    <ul
      aria-label={tNav('legend')}
      data-map-legend={variant}
      className={cn(
        'text-text',
        column
          ? 'flex flex-col gap-3 text-body font-medium leading-snug'
          : inMap
            ? 'grid grid-cols-3 gap-x-2 gap-y-2 text-caption font-medium text-text-secondary'
            : row
              ? 'flex flex-wrap items-center gap-x-5 gap-y-2 text-label-sm font-medium text-text-secondary'
            : 'grid grid-cols-2 gap-x-3 gap-y-2.5 text-label-sm font-medium leading-snug',
        className,
      )}
    >
      {STATES.map(({ state, sw }) => (
        <li key={state} className={cn('flex items-center', column ? 'gap-2.5' : 'gap-2')}>
          <span aria-hidden="true" data-sw={sw} className="t2f-zm-sw">
            {state === 'live' ? <span className={cn('rounded-full bg-background', column ? 'size-1.5' : 'size-1.25')} /> : null}
            {state === 'next' ? <Icon name="clock" size={12} strokeWidth={2.6} className={column ? undefined : 'size-2.5'} /> : null}
          </span>
          {inMap ? t(`short.${state}`) : t(state)}
        </li>
      ))}
      {row ? <li aria-hidden="true" className="h-4 w-px bg-border" /> : null}
      <li className={cn('flex items-center', column ? 'gap-2.5' : 'gap-2')}>
        <span aria-hidden="true" className={cn('inline-flex flex-none items-center justify-center', column ? 'h-4.5 w-7' : 'h-3.5 w-5.5')}>
          <span className="t2f-zm-dot-quiet t2f-zm-dot-legend size-2 rounded-full" />
        </span>
        {t('city')}
      </li>
      <li className={cn('flex items-center', column ? 'gap-2.5' : 'gap-2')}>
        <span aria-hidden="true" className={cn('relative inline-flex flex-none items-center justify-center', column ? 'h-4.5 w-7' : 'h-3.5 w-5.5')}>
          <span className="t2f-zm-halo size-2.5" />
          <span className="relative size-2.5 rounded-full bg-zone-live ring-2 ring-on-primary" />
        </span>
        {t('stream')}
      </li>
    </ul>
  );
}
