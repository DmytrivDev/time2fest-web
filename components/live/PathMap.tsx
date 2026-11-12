'use client';

/**
 * C13 PathMap — мінікарта шляху автора («Шлях <нік>»). Та сама геометрія, що й мапа поясів (`data/zonemap.json`),
 * приглушена; точки в порядку часу: зустрінуті — жовті з пунктирною лінією, остання більша; майбутні з графіка —
 * порожні точки й сірий пунктир. Кожна точка — кнопка з Tooltip: «Дубай · північ о 22:00 за вашим часом».
 * На дотик Tooltip стає Popover.
 * Геометрія підвантажується окремим шматком; поки її немає — скелетон.
 * Масштаб (правка власника 2026-11-09, картка автора): товщини ліній, пунктир і розміри точок рахуються від ширини
 * мапи (`--pm-k`): на мапі графіка й паспорта на десктопі (≈970 px) — як були, у картці автора й на телефоні (≈300–360 px)
 * — тонші й дрібніші, щоб мапа виглядала як велика, лише зменшена. Кілька точок одного поясу — вузол і промені (`hubOf`).
 * Сусідні точки (Сеул і Токіо, Мельбурн і Сідней) — кожна зі своєю підказкою (правка власника 2026-11-10): мишка —
 * підказка найближчої до курсора точки (до 22 px від неї, `nearestPoint`); дотик і клік — зона точки до 44 px, але не
 * більша за відстань до сусідньої точки (`hitSizes`), тож зони не перекриваються.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState, type CSSProperties } from 'react';
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
  /** Стан поясів (`utc+0200` → `past`…): пояси підсвічуються приглушено, як на мапі головної («Мій графік», 2026-11-06). */
  zoneStates?: Readonly<Record<string, 'past' | 'live' | 'next' | 'future'>>;
  /** Відвідані країни (пояс + країна) — заливаються золотом поверх поясів (паспорт і графік, рішення 2026-11-07). */
  visited?: readonly { zoneId: string; iso: string }[];
  /** Мапа шляху без пасу: затемнена й розмита, без точок і ліній (рішення власника 2026-11-07). */
  locked?: boolean;
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

/** Мишка ближче за стільки px до точки — її підказка. */
const HOVER_RADIUS = 22;

/** Ширина мапи, на якій точки й лінії мають базовий розмір (мапа «Мій графік» / паспорт на десктопі). */
export const PATHMAP_BASE_WIDTH = 968;

/** Коефіцієнт масштабу точок і ліній від ширини мапи: корінь відношення (дрібна мапа — не пропорційно дрібніші точки), 0.6…1. */
export function pathMapScale(width: number): number {
  if (!(width > 0)) return 1;
  return Math.round(Math.min(1, Math.max(0.6, Math.sqrt(width / PATHMAP_BASE_WIDTH))) * 100) / 100;
}

/** Стежить за шириною мапи й повертає `--pm-k` (до виміру — 1). */
function useMapScale(): [(el: HTMLDivElement | null) => void, number] {
  const [k, setK] = useState(1);
  const ref = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    const apply = () => setK(pathMapScale(el.getBoundingClientRect().width));
    apply();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(apply);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, k];
}

export function PathLegend({ className }: { className?: string }) {
  const t = useTranslations('windows.author');
  return (
    <ul className={cn('flex flex-wrap gap-x-4 gap-y-1 text-caption text-text-secondary', className)} data-row="legend">
      <li className="flex min-h-5 items-center gap-1.5">
        <span aria-hidden="true" className="flex size-3.5 items-center justify-center">
          <span className="size-2 rounded-full bg-highlight" />
        </span>
        {t('legendMet')}
      </li>
      <li className="flex min-h-5 items-center gap-1.5">
        <span aria-hidden="true" className="flex size-3.5 items-center justify-center">
          <span className="size-2.5 rounded-full border-2 border-text-secondary" />
        </span>
        {t('legendSchedule')}
      </li>
    </ul>
  );
}

/**
 * Діаметр зони кожної точки у відсотках ширини мапи: відстань до найближчої іншої точки (кола сусідів лише
 * торкаються); точка сама — `Infinity` (зона 44 px). `pos` — відсотки ширини (`left`) і висоти (`top`), `aspect` — висота/ширина.
 */
export function hitSizes(pos: readonly { left: number; top: number }[], aspect: number): number[] {
  return pos.map((a, i) => {
    let best = Infinity;
    pos.forEach((b, j) => {
      if (i === j) return;
      const d = Math.hypot(a.left - b.left, (a.top - b.top) * aspect);
      if (d < best) best = d;
    });
    // Та сама точка двічі (дві події одного міста) — зона не зникає зовсім.
    return Math.max(best, 1);
  });
}

/** Індекс точки, найближчої до курсора (`x`, `y` — px від лівого верхнього кута мапи), не далі `radius`; інакше -1. */
export function nearestPoint(pos: readonly { left: number; top: number }[], width: number, height: number, x: number, y: number, radius: number): number {
  let best = -1;
  let bestD = radius;
  pos.forEach((p, i) => {
    const d = Math.hypot((p.left / 100) * width - x, (p.top / 100) * height - y);
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  });
  return best;
}

/**
 * Відрізок маршруту на мапі з розрізом: якщо точки ближчі через край мапи (Гаваї → Самоа, Аляска → Кірибаті), лінія
 * виходить за край і продовжується з протилежного боку — дві частини, кожну обрізає полотно (власник 2026-11-11:
 * лінія через усю мапу плутала).
 */
export function wrapSegment(a: { x: number; y: number }, b: { x: number; y: number }, span: number): [number, number, number, number][] {
  const dx = b.x - a.x;
  if (Math.abs(dx) <= span / 2) return [[a.x, a.y, b.x, b.y]];
  const shift = dx > 0 ? -span : span;
  return [
    [a.x, a.y, b.x + shift, b.y],
    [a.x - shift, a.y, b.x, b.y],
  ];
}

export function PathMap({ points: pointsProp, authorName, summary, geometry: geometryProp, zoneStates, visited, locked = false, className }: PathMapProps) {
  const points = locked ? [] : pointsProp;
  const t = useTranslations('windows.author');
  const c = useTranslations('chat.author');
  const geometry = useGeometry(geometryProp);
  const [measure, k] = useMapScale();
  // Підказка: `hover` — найближча до мишки точка (поки мишка над мапою, головна); `tip` — з Radix (фокус, дотик, Esc).
  const [hover, setHover] = useState<string | null>(null);
  const [tip, setTip] = useState<string | null>(null);

  if (!geometry) {
    return <Skeleton variant="block" className={cn('aspect-video w-full', className)} />;
  }
  const { meta } = geometry;
  // Ширина всього світу в пікселях мапи (360°) — для ліній через край.
  const span = 360 * meta.pxPerDeg;
  const placed = points.map((p) => {
    const pos = pointToPercent(p, meta);
    return { p, pos, px: { x: (pos.left / 100) * meta.width, y: (pos.top / 100) * meta.height } };
  });
  const hits = hitSizes(
    placed.map((x) => x.pos),
    meta.height / meta.width,
  );
  const lastMet = placed.reduce((acc, cur, i) => (!cur.p.planned && !cur.p.hubOf ? i : acc), -1);
  // Варіант B «вузол і промені»: маршрут — через вузли (точки без `hubOf`), промені — від вузла до інших країн поясу.
  const route = placed.filter((x) => !x.p.hubOf);
  const byId = new Map(placed.map((x) => [x.p.id, x]));
  const rays = placed.filter((x) => x.p.hubOf && byId.has(x.p.hubOf));

  return (
    <div
      ref={measure}
      className={cn('t2f-pathmap relative w-full overflow-hidden rounded-md bg-surface', className)}
      style={{ aspectRatio: meta.width / meta.height, '--pm-k': k } as CSSProperties}
      data-locked={locked || undefined}
    >
      <svg viewBox={`0 0 ${meta.width} ${meta.height}`} aria-hidden="true" className={cn('absolute inset-0 block size-full', locked && 't2f-pathmap-locked')}>
        {geometry.zones.map((g) => (
          <path key={g.zoneId} d={g.countries.map((c) => c.d).join('')} className="t2f-pathmap-zone" data-state={zoneStates?.[g.zoneId]} />
        ))}
        {!locked && visited?.length
          ? geometry.zones.flatMap((g) =>
              g.countries
                .filter((c) => visited.some((v) => v.zoneId === g.zoneId && v.iso === c.iso))
                .map((c) => <path key={`v-${g.zoneId}-${c.iso}`} d={c.d} className="t2f-pathmap-visited" data-visited={c.iso} />),
            )
          : null}
        {rays.map((cur) => {
          const hub = byId.get(cur.p.hubOf!)!;
          return wrapSegment(hub.px, cur.px, span).map(([x1, y1, x2, y2], j) => (
            <line
              key={`ray-${cur.p.id}-${j}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="t2f-pathmap-line"
              data-kind={cur.p.planned ? 'planned' : 'met'}
              data-ray=""
            />
          ));
        })}
        {route.slice(1).map((cur, i) => {
          const prev = route[i]!;
          const kind = cur.p.planned ? 'planned' : 'met';
          return wrapSegment(prev.px, cur.px, span).map(([x1, y1, x2, y2], j) => (
            <line
              key={`${prev.p.id}-${cur.p.id}-${j}`}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              className="t2f-pathmap-line"
              data-kind={kind}
              {...(j > 0 ? { 'data-wrap': '' } : {})}
            />
          ));
        })}
      </svg>
      <div
        role="group"
        aria-label={summary ? c('mapLabel', { name: authorName, route: summary }) : t('pathOf', { name: authorName })}
        className="absolute inset-0"
        onPointerMove={(e) => {
          if (e.pointerType !== 'mouse') return;
          const r = e.currentTarget.getBoundingClientRect();
          const i = nearestPoint(
            placed.map((x) => x.pos),
            r.width,
            r.height,
            e.clientX - r.left,
            e.clientY - r.top,
            HOVER_RADIUS,
          );
          const id = i >= 0 ? placed[i]!.p.id : null;
          if (id !== hover) setHover(id);
        }}
        onPointerLeave={() => setHover(null)}
      >
        {placed.map(({ p, pos }, i) => {
          const time = formatClock(p.midnightMs);
          // Вид точки — у `data-dot`; розміри й кільця — у PathMap.css (масштабуються від `--pm-k`).
          const dot = p.current
            ? 'now'
            : p.hubOf
              ? p.planned
                ? 'ray-planned'
                : 'ray-met'
              : p.planned
                ? 'planned'
                : i === lastMet
                  ? 'last'
                  : 'met';
          return (
            <div
              key={p.id}
              className="t2f-pathmap-hit absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${pos.left}%`, top: `${pos.top}%`, ...(Number.isFinite(hits[i]) ? { '--pm-hit': `${hits[i]}%` } : {}) } as CSSProperties}
            >
              <Tooltip
                open={hover !== null ? hover === p.id : tip === p.id}
                onOpenChange={(next) => setTip((cur) => (next ? p.id : cur === p.id ? null : cur))}
                content={
                  <span className="flex flex-col gap-0.5">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Flag code={p.flagCode} size="xs" decorative />
                      {p.city} · {p.country}
                    </span>
                    <span>{t('pointTooltip', { place: p.city, time })}</span>
                    {p.planned ? <span className="text-text-muted">{t('legendSchedule')}</span> : null}
                  </span>
                }
              >
                <button
                  type="button"
                  aria-label={`${p.city}, ${p.country} · ${p.planned ? t('legendSchedule') : t('legendMet')} · ${time}`}
                  data-point={p.current ? 'now' : p.planned ? 'planned' : 'met'}
                  data-ray={p.hubOf ? '' : undefined}
                  data-current={i === lastMet ? '' : undefined}
                  className="t2f-focus flex size-full items-center justify-center rounded-full"
                >
                  <span
                    aria-hidden="true"
                    data-dot={dot}
                    className="t2f-pathmap-dot rounded-full"
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
