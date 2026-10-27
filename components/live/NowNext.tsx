'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { Carousel, CarouselArrow, useCarousel } from '@/components/primitives/Carousel';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { useNow } from '@/lib/time/TimeProvider';
import { EventCard, type EventCardData } from './EventCard';
import { hasStreamNow, isPastStatus, sortForStrip, withStatus } from './eventCards';
import { FestProgress, type FestProgressProps } from './Progress';
import s from './nowNext.module.css';

export interface NowNextProps {
  items: readonly EventCardData[];
  /** Пояс глядача для підпису: «Київ». */
  zoneLabel: string;
  /** `carousel` — десктоп · `stack` — телефон: 4 картки і «Показати ще N». */
  layout?: 'carousel' | 'stack';
  /** Фільтр «Лише з трансляціями»: керований або з початковим значенням. */
  filterLiveOnly?: boolean;
  defaultFilterLiveOnly?: boolean;
  onFilterLiveOnlyChange?: (next: boolean) => void;
  /** Скільки карток на телефоні до «Показати ще». */
  stackLimit?: number;
  /** Скільки минулих подій лишити зліва в каруселі (на телефоні минулих немає). */
  pastLimit?: number;
  progress?: FestProgressProps;
  /** Посилання «Перейти до мапи» (телефон). */
  mapHref?: string;
  loading?: boolean;
  onToggleSchedule?: (id: string, next: boolean) => void;
  /** Подія в плеєрі ефіру: її картка — «В ефірі» (і лишається в стрічці після півночі). */
  airEventId?: string | null;
  className?: string;
}

/** C5. «Зараз і далі»: заголовок, перемикач «Лише з трансляціями», стрічка (десктоп) або стопка (телефон), «Прогрес свята». */
export function NowNext({
  items,
  zoneLabel,
  layout = 'carousel',
  filterLiveOnly,
  defaultFilterLiveOnly = false,
  onFilterLiveOnlyChange,
  stackLimit = 4,
  pastLimit,
  progress,
  mapHref,
  loading = false,
  onToggleSchedule,
  airEventId,
  className,
}: NowNextProps) {
  const t = useTranslations('liveCards.nowNext');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const tCarousel = useTranslations('primitives.carousel');
  const titleId = useId();
  const now = useNow({ granularity: 'minute' });
  const [innerFilter, setInnerFilter] = useState(defaultFilterLiveOnly);
  const [expanded, setExpanded] = useState(false);
  const liveOnly = filterLiveOnly ?? innerFilter;
  const stack = layout === 'stack';
  // Стрілки стрічки — у рядку заголовка праворуч (рішення власника): видно з початку, ніколи не над картками.
  const strip = useCarousel();
  // Макет `Main`: стрічка починається з події в ефірі (минулі — лише в «Список» мапи й на сторінках країн).
  const keepPast = pastLimit ?? 0;

  const visible = useMemo(() => {
    const all = withStatus(now, items);
    const filtered = liveOnly ? all.filter((i) => hasStreamNow(i)) : all;
    const sorted = sortForStrip(filtered);
    const past = sorted.filter((i) => isPastStatus(i.status) && i.id !== airEventId);
    const rest = sorted.filter((i) => !isPastStatus(i.status) || i.id === airEventId);
    return [...past.slice(Math.max(0, past.length - keepPast)), ...rest];
  }, [now, items, liveOnly, keepPast, airEventId]);

  const shown = stack && !expanded ? visible.slice(0, stackLimit) : visible;
  const hidden = visible.length - shown.length;

  const setFilter = (next: boolean) => {
    if (filterLiveOnly === undefined) setInnerFilter(next);
    onFilterLiveOnlyChange?.(next);
  };

  const card = (item: (typeof visible)[number]) => (
    <EventCard key={item.id} {...item} layout={stack ? 'stack' : 'carousel'} onAir={item.id === airEventId} onToggleSchedule={onToggleSchedule} />
  );

  let body;
  if (loading) {
    body = (
      <div aria-busy="true" className={cn('flex gap-2', stack && 'flex-col')}>
        <span className="sr-only">{tCommon('loading')}</span>
        {Array.from({ length: stack ? 3 : 4 }, (_, i) => (
          <Skeleton key={i} variant="block" className={cn('h-35 rounded-md', stack ? 'w-full' : 'w-58 shrink-0')} />
        ))}
      </div>
    );
  } else if (visible.length === 0) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md bg-surface p-4">
        <p className="text-body text-text-secondary">{t('empty')}</p>
        <Button variant="secondary" onClick={() => setFilter(false)}>
          {t('showAll')}
        </Button>
      </div>
    );
  } else if (stack) {
    body = (
      <>
        <ol aria-label={t('listLabel')} className={s.stack}>
          {shown.map((item) => (
            <li key={item.id}>{card(item)}</li>
          ))}
        </ol>
        {hidden > 0 || expanded || mapHref ? (
          <div className={s.stackFoot}>
            {hidden > 0 || expanded ? (
              <button type="button" aria-expanded={expanded} onClick={() => setExpanded((v) => !v)} className={cn('t2f-focus t2f-press t2f-transition', s.moreBtn)}>
                {expanded ? t('showLess') : t('showMore', { count: hidden })}
                <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={18} strokeWidth={2} />
              </button>
            ) : (
              <span />
            )}
            {mapHref ? (
              <a href={mapHref} className={cn('t2f-focus rounded-sm', s.toMap)}>
                {t('toMap')}
                <Icon name="arrow-down" size={16} strokeWidth={2} />
              </a>
            ) : null}
          </div>
        ) : null}
      </>
    );
  } else {
    body = (
      <Carousel label={t('listLabel')} arrows="none" controller={strip}>
        {shown.map(card)}
      </Carousel>
    );
  }

  return (
    <section aria-labelledby={titleId} data-now-next="" data-layout={layout} className={cn(s.section, className)}>
      <SectionHeader
        id={titleId}
        title={tNav('nowAndNext')}
        meta={t('meta', { zone: zoneLabel })}
        action={
          <div className="flex items-center gap-4">
            <Switch label={tNav('onlyWithStreams')} labelSide="end" checked={liveOnly} onCheckedChange={setFilter} />
            {!stack && !loading && visible.length > 0 ? (
              <span className="flex items-center gap-1">
                <CarouselArrow dir="prev" size="md" label={tCarousel('prevEvents')} disabled={!strip.canPrev} onClick={strip.prev} />
                <CarouselArrow dir="next" size="md" label={tCarousel('nextEvents')} disabled={!strip.canNext} onClick={strip.next} />
              </span>
            ) : null}
          </div>
        }
      />
      {body}
      {progress ? <FestProgress {...progress} /> : null}
    </section>
  );
}
