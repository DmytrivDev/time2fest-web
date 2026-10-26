'use client';

/**
 * C13 PathMap — мінікарта шляху автора («Шлях <нік>»). Та сама геометрія, що й мапа поясів (`data/zonemap.json`),
 * приглушена; точки в порядку часу: зустрінуті — жовті з пунктирною лінією, остання більша, місто «Першого ряду» —
 * подвійне кільце; майбутні з графіка — порожні точки й сірий пунктир. Кожна точка — кнопка з Tooltip:
 * «Дубай · північ о 22:00 за вашим часом» (+ «Перший ряд · місце 7»). На дотик Tooltip стає Popover.
 * Геометрія підвантажується окремим шматком; поки її немає — скелетон.
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Tooltip } from '@/components/primitives/Tooltip';
import type { PathPoint } from '@/lib/chat-sim/authorPath';
import { formatClock } from '@/lib/i18n/time';
import { pointToPercent, type ZoneMapGeometry } from './MapModel';
import './PathMap.css';

export interface PathMapProps {
  points: readonly PathPoint[];
  /** Для назви області: «Шлях Karim». */
  authorName: string;
  /** Підпис області для зчитувача (маршрут словами). */
  summary?: string;
  /** Готова геометрія (історії, тести); без неї підвантажується. */
  geometry?: ZoneMapGeometry;
  className?: string;
}

function useGeometry(initial: ZoneMapGeometry | undefined): ZoneMapGeometry | null {
  const [loaded, setLoaded] = useState<ZoneMapGeometry | null>(null);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    import('@/data/zonemap.json')
      .then((m) => {
        if (alive) setLoaded(m.default as unknown as ZoneMapGeometry);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [initial]);
  return initial ?? loaded;
}

export function PathLegend({ className }: { className?: string }) {
  const t = useTranslations('windows.author');
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-secondary', className)} data-row="legend">
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full bg-highlight" />
        {t('legendMet')}
      </li>
      <li className="flex items-center gap-1.5">
        <span aria-hidden="true" className="size-3 rounded-full border-2 border-text-muted bg-background" />
        {t('legendSchedule')}
      </li>
    </ul>
  );
}

export function PathMap({ points, authorName, summary, geometry: geometryProp, className }: PathMapProps) {
  const t = useTranslations('windows.author');
  const c = useTranslations('chat.author');
  const geometry = useGeometry(geometryProp);

  if (!geometry) {
    return <Skeleton variant="block" className={cn('aspect-video w-full', className)} />;
  }
  const { meta } = geometry;
  const placed = points.map((p) => {
    const pos = pointToPercent(p, meta);
    return { p, pos, px: { x: (pos.left / 100) * meta.width, y: (pos.top / 100) * meta.height } };
  });
  const lastMet = placed.reduce((acc, cur, i) => (!cur.p.planned ? i : acc), -1);

  return (
    <div className={cn('relative w-full overflow-hidden rounded-md bg-surface', className)} style={{ aspectRatio: meta.width / meta.height }}>
      <svg viewBox={`0 0 ${meta.width} ${meta.height}`} aria-hidden="true" className="absolute inset-0 block size-full">
        {geometry.zones.map((g) => (
          <path key={g.zoneId} d={g.d} className="t2f-pathmap-zone" />
        ))}
        {placed.slice(1).map((cur, i) => {
          const prev = placed[i]!;
          const kind = cur.p.planned ? 'planned' : 'met';
          return (
            <line
              key={`${prev.p.id}-${cur.p.id}`}
              x1={prev.px.x}
              y1={prev.px.y}
              x2={cur.px.x}
              y2={cur.px.y}
              className="t2f-pathmap-line"
              data-kind={kind}
            />
          );
        })}
      </svg>
      <div role="group" aria-label={summary ? c('mapLabel', { name: authorName, route: summary }) : t('pathOf', { name: authorName })} className="absolute inset-0">
        {placed.map(({ p, pos }, i) => {
          const time = formatClock(p.midnightMs);
          const dot = p.planned
            ? 'size-3 border-2 border-text-muted bg-background'
            : cn('border-2 border-background bg-highlight', i === lastMet ? 'size-4' : 'size-3');
          return (
            <div
              key={p.id}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos.left}%`, top: `${pos.top}%` }}
            >
              <Tooltip
                content={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Flag code={p.flagCode} size="xs" decorative />
                      {p.city} · {p.country}
                    </span>
                    <span>{t('pointTooltip', { place: p.city, time })}</span>
                    {p.firstRowSeat ? <span>{c('pointSeat', { seat: p.firstRowSeat })}</span> : null}
                    {p.planned ? <span className="text-text-muted">{t('legendSchedule')}</span> : null}
                  </span>
                }
              >
                <button
                  type="button"
                  aria-label={`${p.city}, ${p.country} · ${p.planned ? t('legendSchedule') : t('legendMet')} · ${time}`}
                  data-point={p.planned ? 'planned' : 'met'}
                  data-current={i === lastMet ? '' : undefined}
                  className="t2f-focus flex size-touch-min items-center justify-center rounded-full"
                >
                  <span
                    aria-hidden="true"
                    className={cn('rounded-full', dot, p.firstRowSeat ? 'outline-2 outline-offset-2 outline-highlight' : undefined)}
                  />
                </button>
              </Tooltip>
            </div>
          );
        })}
      </div>
    </div>
  );
}
