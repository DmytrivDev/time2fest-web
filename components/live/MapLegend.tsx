'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import type { ZoneState } from '@/lib/engine/zoneState';
import './ZoneMap.css';

export interface MapLegendProps {
  /** На десктопі точка з трансляцією веде на країну («дивитися»), на телефоні — відкриває картку. */
  layout?: 'phone' | 'desktop';
  className?: string;
}

const STATES: readonly { state: ZoneState; sw: 'past' | 'live' | 'next' | 'ahead' }[] = [
  { state: 'past', sw: 'past' },
  { state: 'live', sw: 'live' },
  { state: 'next', sw: 'next' },
  { state: 'future', sw: 'ahead' },
];

/** C18 `MapLegend`: чотири стани поясу (зразок + підпис) і два види точок міст. */
export function MapLegend({ layout = 'phone', className }: MapLegendProps) {
  const t = useTranslations('liveMap.legend');
  const tNav = useTranslations('nav');
  return (
    <ul aria-label={tNav('legend')} data-map-legend="" className={cn('grid grid-cols-2 gap-x-3 gap-y-2 text-body text-text', className)}>
      {STATES.map(({ state, sw }) => (
        <li key={state} className="flex items-center gap-2">
          <span aria-hidden="true" data-sw={sw} className="t2f-zm-sw">
            {state === 'live' ? <span className="size-1.5 rounded-full bg-background" /> : null}
            {state === 'next' ? <Icon name="clock" size={16} className="size-2.5" /> : null}
          </span>
          {t(state)}
        </li>
      ))}
      <li className="col-span-2 flex items-center gap-2">
        <span aria-hidden="true" className="relative inline-flex h-3.5 w-5.5 flex-none items-center justify-center">
          <span className="t2f-zm-halo size-2.5" />
          <span className="relative size-2.5 rounded-full bg-zone-live ring-2 ring-text" />
        </span>
        {layout === 'phone' ? t('stream') : t('streamDesktop')}
      </li>
      <li className="col-span-2 flex items-center gap-2">
        <span aria-hidden="true" className="inline-flex h-3.5 w-5.5 flex-none items-center justify-center">
          <span className="size-2 rounded-full bg-text-secondary ring-2 ring-border-strong" />
        </span>
        {t('city')}
      </li>
    </ul>
  );
}
