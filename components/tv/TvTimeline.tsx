'use client';

/**
 * TvTimeline (C22): таймлайн всього свята під плеєром. За замовчуванням схований: «Свято по поясах · за вашим часом»,
 * фільтри «Лише з трансляціями» і «У моєму графіку», прогрес свята й кнопка «↓ Показати все свято».
 * Відкритий — смуга карток (`TvQueueCard`), минулі події ліворуч за краєм (перша видима — поточна), стрілки гортання.
 * Фільтри — той самий `hasStreamNow` / графік, що на головній і в списку країн (одна логіка скрізь).
 * Нічого не лежить поверх відео: таймлайн стоїть у безпечній зоні під плеєром.
 */
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { EventCardItem } from '@/components/live/eventCards';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { useReducedMotion } from '@/lib/a11y/reducedMotion';
import type { Ms } from '@/lib/data/types';
import { formatClock } from '@/lib/i18n/time';
import { filterTimeline, type TvTimelineFilters } from '@/lib/tv/tvData';
import { TvQueueCard } from './TvQueueCard';
import styles from './tv.module.css';

export interface TvTimelineProps {
  /** Усі слоти свята (`tvEvents`). */
  items: readonly EventCardItem[];
  /** Подія, що йде в ефірі. */
  currentEventId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Поясів, що вже зустріли Новий рік, і всього. */
  zonesDone: number;
  zonesTotal: number;
  /** Скільки поясів лишилось і коли остання північ. */
  remainingZones: number;
  endMs: Ms;
  /** Підказка клавіш під таймлайном (`TvKeyHints`). */
  hints?: ReactNode;
  className?: string;
}

function FilterToggle({
  pressed,
  icon,
  onChange,
  children,
}: {
  pressed: boolean;
  icon: IconName;
  onChange: (v: boolean) => void;
  children: string;
}) {
  return (
    <button type="button" aria-pressed={pressed} onClick={() => onChange(!pressed)} className={cn('t2f-focus t2f-transition', styles.filter)}>
      <Icon name={icon} size={20} />
      {children}
    </button>
  );
}

export function TvTimeline({ items, currentEventId, open, onOpenChange, zonesDone, zonesTotal, remainingZones, endMs, hints, className }: TvTimelineProps) {
  const t = useTranslations('tv');
  const locale = useLocale();
  const reduced = useReducedMotion();
  const [filters, setFilters] = useState<TvTimelineFilters>({ onlyStreams: false, mySchedule: false });
  const visible = useMemo(() => filterTimeline(items, filters, currentEventId), [items, filters, currentEventId]);
  const stripRef = useRef<HTMLOListElement>(null);
  const showAllRef = useRef<HTMLButtonElement>(null);
  const [edge, setEdge] = useState({ start: true, end: false });

  const pct = zonesTotal > 0 ? Math.round((zonesDone / zonesTotal) * 100) : 0;
  const progressText = t('progress', { zones: zonesDone, total: zonesTotal });

  const measure = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    setEdge({ start: el.scrollLeft <= 1, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 1 });
  }, []);

  // Відкрили: перша видима картка — поточна подія, минулі лишаються ліворуч за краєм.
  useEffect(() => {
    if (!open) return;
    const el = stripRef.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="true"]');
    if (current) el.scrollLeft = Math.max(0, current.offsetLeft - el.offsetLeft);
    measure();
  }, [open, measure]);

  // Повернення фокуса на кнопку, коли таймлайн сховали («Назад»).
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) showAllRef.current?.focus();
    wasOpen.current = open;
  }, [open]);

  const scrollBy = (dir: -1 | 1) => {
    const el = stripRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: reduced ? 'auto' : 'smooth' });
  };

  return (
    <section aria-labelledby="tv-timeline-title" data-tv-timeline={open ? 'open' : 'closed'} className={cn(styles.timeline, className)}>
      <div className="flex items-center gap-4">
        <h2 id="tv-timeline-title" className="whitespace-nowrap text-tv-title text-text">
          {t('timelineTitle')}
        </h2>
        <span className="flex-1" />
        <div role="group" aria-label={t('timelineFilters')} className="flex gap-3">
          <FilterToggle pressed={filters.onlyStreams} icon="broadcast" onChange={(v) => setFilters((f) => ({ ...f, onlyStreams: v }))}>
            {t('filterOnlyStreams')}
          </FilterToggle>
          <FilterToggle pressed={filters.mySchedule} icon="calendar" onChange={(v) => setFilters((f) => ({ ...f, mySchedule: v }))}>
            {t('filterMySchedule')}
          </FilterToggle>
        </div>
      </div>

      <div
        role="progressbar"
        aria-label={t('progressTitle')}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct}%: ${progressText}`}
        className={styles.progress}
      >
        <span className="whitespace-nowrap text-tv-text text-text-secondary">
          <span className="font-bold text-text">{t('progressTitle')}</span> · {progressText}
        </span>
        <span aria-hidden="true" className={styles.progressTrack}>
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
        </span>
      </div>

      {open ? (
        <div className={styles.stripWrap}>
          <IconButton
            icon="chevron-left"
            size="tv"
            variant="plain"
            aria-label={t('timelinePrev')}
            disabled={edge.start}
            onClick={() => scrollBy(-1)}
            className={styles.stripPrev}
          />
          <ol ref={stripRef} onScroll={measure} aria-label={t('timelineList')} className={styles.strip}>
            {visible.map((it) => (
              <li key={it.id} className="contents">
                <TvQueueCard item={it} layout="strip" onAir={it.id === currentEventId} />
              </li>
            ))}
            {visible.length === 0 ? <li className="self-center text-tv-text text-text-secondary">{t('timelineEmpty')}</li> : null}
          </ol>
          <IconButton
            icon="chevron-right"
            size="tv"
            variant="plain"
            aria-label={t('timelineNext')}
            disabled={edge.end}
            onClick={() => scrollBy(1)}
            className={styles.stripNext}
          />
        </div>
      ) : (
        <button
          ref={showAllRef}
          type="button"
          aria-expanded={false}
          aria-label={t('showAllAria')}
          onClick={() => onOpenChange(true)}
          className={cn('t2f-focus t2f-transition', styles.showAll)}
        >
          <span aria-hidden="true" className={styles.keycap}>
            ↓
          </span>
          {t('showAll')}
          <span className="flex-1" />
          <span className="font-medium text-text-muted">{t('showAllHint', { zones: remainingZones, time: formatClock(endMs, { locale }) })}</span>
        </button>
      )}

      <div className={styles.hintRow}>
        {open ? (
          <button type="button" aria-expanded onClick={() => onOpenChange(false)} className={cn('t2f-focus t2f-transition', styles.hideAll)}>
            <span aria-hidden="true" className={styles.keycap}>
              ↑
            </span>
            {t('hideAll')}
          </button>
        ) : null}
        {hints}
      </div>
    </section>
  );
}
