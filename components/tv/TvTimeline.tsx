'use client';

/**
 * TvTimeline (C22, дошка `TV-Party-New`, рішення 2026-11-06): таймлайн свята під плеєром — завжди відкритий.
 * «Свято по поясах · програма й твій графік», фільтр «Усі · З трансляціями · Мій графік», «Прогрес свята»,
 * смуга карток (`TvTimelineCard`): програма автопілота й події графіка; минулі — ліворуч за краєм (перша видима — поточна).
 * Гортається фокусом пульта (← →); нічого не лежить поверх відео.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '@/components/primitives/cn';
import { Icon, type IconName } from '@/components/primitives/Icon';
import { filterTimeline, type TvTimelineFilter, type TvTimelineItem } from '@/lib/tv/tvData';
import { TvTimelineCard, type TvCardAction } from './TvTimelineCard';
import styles from './tv.module.css';

export interface TvTimelineProps {
  /** Програма й події графіка (`tvTimeline`). */
  items: readonly TvTimelineItem[];
  /** Подія, що зараз на екрані. */
  onAirId: string | null;
  /** «Мій графік» з пасом: картки програми поза графіком приглушені. */
  dimOutside?: boolean;
  /** Поясів, що вже зустріли Новий рік, і всього. */
  zonesDone: number;
  zonesTotal: number;
  actionFor: (item: TvTimelineItem) => TvCardAction;
  onActivate: (item: TvTimelineItem) => void;
  /** Підказка клавіш під таймлайном (`TvKeyHints`). */
  hints?: ReactNode;
  className?: string;
}

const FILTERS: readonly { key: TvTimelineFilter; label: 'filterAll' | 'filterLive' | 'filterMine'; icon?: IconName }[] = [
  { key: 'all', label: 'filterAll' },
  { key: 'live', label: 'filterLive', icon: 'broadcast' },
  { key: 'mine', label: 'filterMine', icon: 'calendar-check' },
];

export function TvTimeline({ items, onAirId, dimOutside = false, zonesDone, zonesTotal, actionFor, onActivate, hints, className }: TvTimelineProps) {
  const t = useTranslations('tv');
  const [filter, setFilter] = useState<TvTimelineFilter>('all');
  const visible = useMemo(() => filterTimeline(items, filter, onAirId), [items, filter, onAirId]);
  const stripRef = useRef<HTMLOListElement>(null);

  const pct = zonesTotal > 0 ? Math.round((zonesDone / zonesTotal) * 100) : 0;
  const progressText = t('progress', { zones: zonesDone, total: zonesTotal });

  // Перша видима картка — подія на екрані; минулі лишаються ліворуч за краєм.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="true"]');
    el.scrollLeft = current ? Math.max(0, current.offsetLeft - el.offsetLeft - 12) : 0;
  }, [onAirId, filter, visible.length]);

  return (
    <section aria-labelledby="tv-timeline-title" data-tv-timeline="" className={cn(styles.timeline, className)}>
      <div className="flex items-center gap-4">
        <h2 id="tv-timeline-title" className={styles.timelineTitle}>
          {t('timelineTitle')}
        </h2>
        <span className={styles.timelineSub}>{t('timelineSub')}</span>
        <span className="flex-1" />
        <div role="group" aria-label={t('timelineFilters')} className={styles.segment} data-tv-filters="">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              aria-pressed={filter === f.key}
              data-filter={f.key}
              onClick={() => setFilter(f.key)}
              className={cn('t2f-focus t2f-transition', styles.segmentItem)}
            >
              {f.icon ? <Icon name={f.icon} size={18} /> : null}
              {t(f.label)}
            </button>
          ))}
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
        <span className="whitespace-nowrap font-bold text-text">{t('progressTitle')}</span>
        <span className="whitespace-nowrap text-text-secondary">{progressText}</span>
        <span aria-hidden="true" className={styles.progressTrack}>
          <span className={styles.progressFill} style={{ width: `${pct}%` }} />
          <span className={styles.progressKnob} style={{ left: `${pct}%` }} />
        </span>
      </div>

      <ol ref={stripRef} aria-label={t('timelineList')} className={styles.strip}>
        {visible.map((it) => (
          <li key={it.id} className="contents">
            <TvTimelineCard
              item={it}
              onAir={it.id === onAirId}
              dim={dimOutside && it.program && !it.inSchedule && it.id !== onAirId}
              initial={it.id === onAirId}
              action={actionFor(it)}
              onActivate={onActivate}
            />
          </li>
        ))}
        {visible.length === 0 ? <li className="self-center text-text-secondary">{t('timelineEmpty')}</li> : null}
      </ol>

      <div className={styles.hintRow}>{hints}</div>
    </section>
  );
}
