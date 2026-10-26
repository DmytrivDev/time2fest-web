'use client';

import { useId, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Carousel } from '@/components/primitives/Carousel';
import { cn } from '@/components/primitives/cn';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { useNow } from '@/lib/time/TimeProvider';
import { EventCard, type EventCardData } from './EventCard';
import { sortForStrip, withStatus } from './eventCards';

export interface CelebrationsSliderProps {
  /** Основні святкування (`isMainCelebration`) усіх поясів. */
  items: readonly EventCardData[];
  onToggleSchedule?: (id: string, next: boolean) => void;
  className?: string;
}

/** Слайдер основних святкувань: ті самі картки подій у каруселі. */
export function CelebrationsSlider({ items, onToggleSchedule, className }: CelebrationsSliderProps) {
  const t = useTranslations('nav');
  const tList = useTranslations('liveCards.celebrations');
  const titleId = useId();
  const now = useNow({ granularity: 'minute' });
  const cards = useMemo(() => sortForStrip(withStatus(now, items)), [now, items]);

  return (
    <section aria-labelledby={titleId} data-celebrations="" className={cn('flex flex-col gap-2', className)}>
      <SectionHeader id={titleId} title={t('mainCelebrations')} />
      <Carousel label={tList('listLabel')}>
        {cards.map((item) => (
          <EventCard key={item.id} {...item} onToggleSchedule={onToggleSchedule} />
        ))}
      </Carousel>
    </section>
  );
}
