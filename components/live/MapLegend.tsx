'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { ZoneState } from '@/lib/engine/zoneState';
import './ZoneMap.css';

export interface MapLegendProps {
  /** На десктопі точка з трансляцією веде на країну («дивитися»), на телефоні — відкриває картку. */
  layout?: 'phone' | 'desktop';
  /** `grid` — 2 колонки під мапою (телефон) · `column` — колонка праворуч від мапи (десктоп, макет `Main`). */
  variant?: 'grid' | 'column';
  className?: string;
}

const STATES: readonly { state: ZoneState; sw: 'past' | 'live' | 'next' | 'ahead' }[] = [
  { state: 'past', sw: 'past' },
  { state: 'live', sw: 'live' },
  { state: 'next', sw: 'next' },
  { state: 'future', sw: 'ahead' },
];

/** C18 `MapLegend`: чотири стани поясу (зразок + підпис) і два види точок міст. */
export function MapLegend({ layout = 'phone', variant = 'grid', className }: MapLegendProps) {
  const column = variant === 'column';
  const t = useTranslations('liveMap.legend');
  const tNav = useTranslations('nav');
  return (
    <ul
      aria-label={tNav('legend')}
      data-map-legend={variant}
      className={cn(
        'text-body text-text',
        column ? 'flex flex-col gap-3 font-medium leading-snug' : 'grid grid-cols-2 gap-x-3 gap-y-2',
        className,
      )}
    >
      {STATES.map(({ state, sw }) => (
        <li key={state} className={cn('flex items-center', column ? 'gap-2.5' : 'gap-2')}>
          <span aria-hidden="true" data-sw={sw} className="t2f-zm-sw">
            {state === 'live' ? <span className={cn('rounded-full bg-background', column ? 'size-1.5' : 'size-1.25')} /> : null}
            {state === 'next' ? <Icon name="clock" size={12} strokeWidth={2.6} className={column ? undefined : 'size-2.5'} /> : null}
          </span>
          {t(state)}
        </li>
      ))}
      <li className={cn('col-span-2 flex items-center', column ? 'gap-2.5' : 'gap-2')}>
        <span aria-hidden="true" className={cn('relative inline-flex flex-none items-center justify-center', column ? 'h-4.5 w-7' : 'h-3.5 w-5.5')}>
          <span className="t2f-zm-halo size-2.5" />
          <span className="relative size-2.5 rounded-full bg-zone-live ring-2 ring-on-primary" />
        </span>
        {layout === 'phone' ? t('stream') : t('streamDesktop')}
      </li>
      <li className={cn('col-span-2 flex items-center', column ? 'gap-2.5' : 'gap-2')}>
        <span aria-hidden="true" className={cn('inline-flex flex-none items-center justify-center', column ? 'h-4.5 w-7' : 'h-3.5 w-5.5')}>
          <span className="t2f-zm-dot-quiet t2f-zm-dot-legend size-2 rounded-full" />
        </span>
        {t('city')}
      </li>
    </ul>
  );
}
