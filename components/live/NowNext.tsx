'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/primitives/Button';
import { Carousel } from '@/components/primitives/Carousel';
import { Chip } from '@/components/primitives/Chip';
import { cn } from '@/components/primitives/cn';
import { Link } from '@/components/primitives/Link';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Switch } from '@/components/primitives/Switch';
import { useNow } from '@/lib/time/TimeProvider';
import { EventCard, type EventCardData } from './EventCard';
import { hasStreamNow, isPastStatus, sortForStrip, withStatus } from './eventCards';
import { FestProgress, type FestProgressProps } from './Progress';

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
  className?: string;
}

/** C5. «Зараз і далі»: заголовок, перемикач «Лише з трансляціями», карусель (десктоп) або стопка (телефон), «Прогрес свята». */
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
  className,
}: NowNextProps) {
  const t = useTranslations('liveCards.nowNext');
  const tNav = useTranslations('nav');
  const tCommon = useTranslations('common');
  const titleId = useId();
  const now = useNow({ granularity: 'minute' });
  const [innerFilter, setInnerFilter] = useState(defaultFilterLiveOnly);
  const [expanded, setExpanded] = useState(false);
  const liveOnly = filterLiveOnly ?? innerFilter;
  const stack = layout === 'stack';
  const keepPast = pastLimit ?? (stack ? 0 : 1);

  const visible = useMemo(() => {
    const all = withStatus(now, items);
    const filtered = liveOnly ? all.filter((i) => hasStreamNow(i)) : all;
    const sorted = sortForStrip(filtered);
    const past = sorted.filter((i) => isPastStatus(i.status));
    const rest = sorted.filter((i) => !isPastStatus(i.status));
    return [...past.slice(Math.max(0, past.length - keepPast)), ...rest];
  }, [now, items, liveOnly, keepPast]);

  const shown = stack && !expanded ? visible.slice(0, stackLimit) : visible;
  const hidden = visible.length - shown.length;

  const setFilter = (next: boolean) => {
    if (filterLiveOnly === undefined) setInnerFilter(next);
    onFilterLiveOnlyChange?.(next);
  };

  const card = (item: (typeof visible)[number]) => (
    <EventCard key={item.id} {...item} layout={layout === 'stack' ? 'stack' : 'carousel'} onToggleSchedule={onToggleSchedule} />
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
        <ul aria-label={t('listLabel')} className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((item) => (
            <li key={item.id}>{card(item)}</li>
          ))}
        </ul>
        {hidden > 0 || expanded || mapHref ? (
          <div className="mt-1 flex items-center justify-between gap-2">
            {hidden > 0 || expanded ? (
              <Chip variant="more" expanded={expanded} onClick={() => setExpanded((v) => !v)}>
                {expanded ? t('showLess') : t('showMore', { count: hidden })}
              </Chip>
            ) : (
              <span />
            )}
            {mapHref ? (
              <Link href={mapHref} variant="chevron">
                {t('toMap')}
              </Link>
            ) : null}
          </div>
        ) : null}
      </>
    );
  } else {
    body = <Carousel label={t('listLabel')}>{shown.map(card)}</Carousel>;
  }

  return (
    <section aria-labelledby={titleId} data-now-next="" data-layout={layout} className={cn('flex flex-col gap-2', className)}>
      <SectionHeader
        id={titleId}
        title={tNav('nowAndNext')}
        meta={t('meta', { zone: zoneLabel })}
        action={<Switch label={tNav('onlyWithStreams')} checked={liveOnly} onCheckedChange={setFilter} compact />}
      />
      {body}
      {progress ? <FestProgress {...progress} className="mt-2" /> : null}
    </section>
  );
}
