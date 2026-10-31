'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ToggleGroup } from 'radix-ui';
import { Button } from '@/components/primitives/Button';
import { Carousel, CarouselArrow, useCarousel } from '@/components/primitives/Carousel';
import { cn } from '@/components/primitives/cn';
import { Icon } from '@/components/primitives/Icon';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { Skeleton } from '@/components/primitives/Skeleton';
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
  /** Без пасу «Мій графік» із замком: натиск — вікно «Графік — у Новорічному пасі» (рішення 2026-10-31). */
  scheduleLocked?: boolean;
  onScheduleLocked?: () => void;
  /** Скільки карток на телефоні до «Показати ще». */
  stackLimit?: number;
  /** Скільки минулих подій лишити зліва в каруселі (на телефоні минулих немає). */
  pastLimit?: number;
  progress?: FestProgressProps;
  /** «Країни й пояси ›» під списком (телефон) — сторінка країн. */
  mapHref?: string;
  loading?: boolean;
  onToggleSchedule?: (id: string, next: boolean) => void;
  /** Подія в плеєрі ефіру: її картка — «В ефірі» (і лишається в стрічці після півночі). */
  airEventId?: string | null;
  className?: string;
}

type Filter = 'all' | 'live' | 'mine';

/**
 * C5. «Зараз і далі»: заголовок, фільтр «Усі · З трансляціями · Мій графік (N)» (сегменти замість перемикача, дошка
 * `Desk-NowNext-Schedule`, рішення 2026-10-31), стрічка (десктоп) або компактний список (телефон: 4 події,
 * «Ще N подій» / «Згорнути», «Країни й пояси ›»), «Прогрес свята».
 */
export function NowNext({
  items,
  zoneLabel,
  layout = 'carousel',
  filterLiveOnly,
  defaultFilterLiveOnly = false,
  onFilterLiveOnlyChange,
  scheduleLocked = false,
  onScheduleLocked,
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
  const [innerFilter, setInnerFilter] = useState<Filter>(defaultFilterLiveOnly ? 'live' : 'all');
  const [expanded, setExpanded] = useState(false);
  const filter: Filter = filterLiveOnly === undefined ? innerFilter : filterLiveOnly ? 'live' : innerFilter === 'mine' ? 'mine' : 'all';
  const liveOnly = filter === 'live';
  const mineOnly = filter === 'mine' && !scheduleLocked;
  const stack = layout === 'stack';
  // Стрілки стрічки — у рядку заголовка праворуч (рішення власника): видно з початку, ніколи не над картками.
  const strip = useCarousel();
  // Макет `Main`: стрічка починається з події в ефірі (минулі — лише в «Список» мапи й на сторінках країн).
  const keepPast = pastLimit ?? 0;

  const visible = useMemo(() => {
    const all = withStatus(now, items);
    const filtered = liveOnly ? all.filter((i) => hasStreamNow(i)) : mineOnly ? all.filter((i) => i.inSchedule) : all;
    const sorted = sortForStrip(filtered);
    const past = sorted.filter((i) => isPastStatus(i.status) && i.id !== airEventId);
    const rest = sorted.filter((i) => !isPastStatus(i.status) || i.id === airEventId);
    return [...past.slice(Math.max(0, past.length - keepPast)), ...rest];
  }, [now, items, liveOnly, mineOnly, keepPast, airEventId]);

  const shown = stack && !expanded ? visible.slice(0, stackLimit) : visible;
  const hidden = visible.length - shown.length;

  const scheduleCount = useMemo(() => withStatus(now, items).filter((i) => i.inSchedule && !isPastStatus(i.status)).length, [now, items]);
  const setFilter = (next: Filter) => {
    if (next === 'mine' && scheduleLocked) {
      onScheduleLocked?.();
      return;
    }
    setInnerFilter(next);
    setExpanded(false);
    if (next === 'live' || filter === 'live') onFilterLiveOnlyChange?.(next === 'live');
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
        <p className="text-body text-text-secondary">{mineOnly ? t('emptyMine') : t('empty')}</p>
        <Button variant="secondary" onClick={() => setFilter('all')}>
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
                <Icon name="chevron-right" size={16} strokeWidth={2} />
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

  const lockedHint = scheduleLocked ? t('mineLocked') : undefined;
  const filterControl = (
    <ToggleGroup.Root
      type="single"
      aria-label={t('filterLabel')}
      value={filter}
      onValueChange={(v) => {
        if (v) setFilter(v as Filter);
      }}
      data-row="filter"
      className={cn(s.filter, stack && s.filterFull)}
    >
      <ToggleGroup.Item value="all" className={cn('t2f-focus', s.seg)}>
        {t('filterAll')}
      </ToggleGroup.Item>
      <ToggleGroup.Item value="live" className={cn('t2f-focus', s.seg)}>
        {stack ? null : <Icon name="broadcast" size={14} />}
        {t('filterLive')}
      </ToggleGroup.Item>
      {/* Без пасу — не перемикає, а відкриває вікно графіка (onValueChange → onScheduleLocked). */}
      <ToggleGroup.Item value="mine" aria-label={lockedHint ? `${t('filterMine')}. ${lockedHint}` : undefined} data-locked={scheduleLocked || undefined} className={cn('t2f-focus', s.seg)}>
        {stack ? null : <Icon name={scheduleLocked ? 'lock' : 'calendar-check'} size={14} />}
        {stack && scheduleLocked ? <Icon name="lock" size={14} /> : null}
        {t('filterMine')}
        {!scheduleLocked && scheduleCount > 0 ? <span className={s.segCount}>{scheduleCount}</span> : null}
      </ToggleGroup.Item>
    </ToggleGroup.Root>
  );

  return (
    <section aria-labelledby={titleId} data-now-next="" data-layout={layout} className={cn(s.section, className)}>
      <SectionHeader
        id={titleId}
        title={tNav('nowAndNext')}
        meta={t('meta', { zone: zoneLabel })}
        action={
          <div className="flex items-center gap-4">
            {stack ? null : filterControl}
            {!stack && !loading && visible.length > 0 ? (
              <span className="flex items-center gap-1">
                <CarouselArrow dir="prev" size="md" label={tCarousel('prevEvents')} disabled={!strip.canPrev} onClick={strip.prev} />
                <CarouselArrow dir="next" size="md" label={tCarousel('nextEvents')} disabled={!strip.canNext} onClick={strip.next} />
              </span>
            ) : null}
          </div>
        }
      />
      {stack ? filterControl : null}
      {body}
      {progress ? <FestProgress {...progress} /> : null}
    </section>
  );
}
