'use client';

/**
 * TvTimeline (C22, дошка `TV-Party-New`, рішення 2026-11-06): таймлайн свята під плеєром — завжди відкритий.
 * «Свято по поясах · програма й твій графік», фільтр «Усі · З трансляціями · Мій графік», «Прогрес свята»,
 * смуга карток (`TvTimelineCard`): програма автопілота й події графіка; минулі — ліворуч за краєм (перша видима — поточна).
 * Гортається фокусом пульта (← →, по одній картці) і перетягуванням мишею; нічого не лежить поверх відео.
 * Компактний вигляд (власник 2026-11-06, `TvScreen`): поки людина не перейшла до таймлайну, картки — лише місто й календарик,
 * а відео більше; таймлайн «активний» (`onActiveChange`), коли в ньому фокус після дії людини або над ним миша.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
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
  /** Людина перейшла до таймлайну (фокус після натискання чи кліку, миша над ним) — показати картки повністю. */
  onActiveChange?: (active: boolean) => void;
  className?: string;
}

/** Людина вже щось натиснула (клавішу, мишу): програмний початковий фокус на картці ще не «перехід до таймлайну». */
function useInteracted(): boolean {
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (done) return;
    const on = () => setDone(true);
    window.addEventListener('keydown', on, true);
    window.addEventListener('pointerdown', on, true);
    return () => {
      window.removeEventListener('keydown', on, true);
      window.removeEventListener('pointerdown', on, true);
    };
  }, [done]);
  return done;
}

/** Зсув мишею, після якого це вже перетягування, а не клік. */
const DRAG_PX = 6;

const FILTERS: readonly { key: TvTimelineFilter; label: 'filterAll' | 'filterLive' | 'filterMine'; icon?: IconName }[] = [
  { key: 'all', label: 'filterAll' },
  { key: 'live', label: 'filterLive', icon: 'broadcast' },
  { key: 'mine', label: 'filterMine', icon: 'calendar-check' },
];

export function TvTimeline({ items, onAirId, dimOutside = false, zonesDone, zonesTotal, actionFor, onActivate, hints, onActiveChange, className }: TvTimelineProps) {
  const t = useTranslations('tv');
  const [filter, setFilter] = useState<TvTimelineFilter>('all');
  const visible = useMemo(() => filterTimeline(items, filter, onAirId), [items, filter, onAirId]);
  const stripRef = useRef<HTMLOListElement>(null);
  const interacted = useInteracted();
  const [focused, setFocused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const active = (focused && interacted) || hovered;
  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);
  // Миша пішла — згортаємо не одразу: картки не «стрибають» під курсором, що проходить повз.
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hover = (on: boolean) => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
    if (on) setHovered(true);
    else leaveTimer.current = setTimeout(() => setHovered(false), 500);
  };
  useEffect(() => () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current);
  }, []);

  // Перетягування мишею (ноутбук): гортає смугу; після перетягування клік по картці не спрацьовує.
  const drag = useRef<{ x: number; left: number; scale: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const onPointerDown = (e: ReactPointerEvent<HTMLOListElement>) => {
    const el = stripRef.current;
    if (!el || e.pointerType !== 'mouse' || e.button !== 0) return;
    // Смуга в макеті, що масштабується (`TvScreen`): зсув миші — в пікселях екрана, прокрутка — в пікселях макета.
    const scale = el.getBoundingClientRect().width / el.offsetWidth || 1;
    drag.current = { x: e.clientX, left: el.scrollLeft, scale, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLOListElement>) => {
    const d = drag.current;
    const el = stripRef.current;
    if (!d || !el) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < DRAG_PX) return;
    if (!d.moved) {
      d.moved = true;
      el.setPointerCapture(e.pointerId);
    }
    el.scrollLeft = d.left - dx / d.scale;
  };
  const endDrag = (e: ReactPointerEvent<HTMLOListElement>) => {
    const d = drag.current;
    drag.current = null;
    if (d?.moved) {
      dragged.current = true;
      stripRef.current?.releasePointerCapture(e.pointerId);
    }
  };

  const pct = zonesTotal > 0 ? Math.round((zonesDone / zonesTotal) * 100) : 0;
  const progressText = t('progress', { zones: zonesDone, total: zonesTotal });

  // Перша видима картка — подія на екрані; минулі лишаються ліворуч за краєм.
  useEffect(() => {
    const el = stripRef.current;
    if (!el) return;
    const current = el.querySelector<HTMLElement>('[aria-current="true"]');
    const pad = parseFloat(getComputedStyle(el).scrollPaddingInlineStart) || 0;
    el.scrollLeft = current ? Math.max(0, current.offsetLeft - el.offsetLeft - pad) : 0;
  }, [onAirId, filter, visible.length]);

  return (
    <section
      aria-labelledby="tv-timeline-title"
      data-tv-timeline=""
      data-active={active ? '' : undefined}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onPointerEnter={(e) => e.pointerType === 'mouse' && hover(true)}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hover(false)}
      className={cn(styles.timeline, className)}
    >
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

      <ol
        ref={stripRef}
        aria-label={t('timelineList')}
        data-tv-strip=""
        className={styles.strip}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(e) => {
          if (!dragged.current) return;
          dragged.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onDragStart={(e) => e.preventDefault()}
      >
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
