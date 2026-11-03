'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock } from '@/lib/i18n/time';
import { utcLabel, type MapCountry, type MapZone } from './MapModel';
import m from './zoneMap.module.css';

const SW: Record<ZoneState, 'past' | 'live' | 'next' | 'ahead'> = { past: 'past', live: 'live', next: 'next', future: 'ahead' };

/** Зразок стану поясу (як у легенді): «наживо» — крапка, «найближча» — годинник. */
export function StateSwatch({ state, className }: { state: ZoneState; className?: string }) {
  return (
    <span aria-hidden="true" data-sw={SW[state]} className={cn('t2f-zm-sw', className)}>
      {state === 'live' ? <span className="size-1.5 rounded-full bg-background" /> : null}
      {state === 'next' ? <Icon name="clock" size={12} strokeWidth={2.6} /> : null}
    </span>
  );
}

/** Прапори поясу: до `max` круглих, заходять один на одний, далі «+N». */
function FlagStack({ countries, max, size }: { countries: readonly MapCountry[]; max: number; size: number }) {
  const more = Math.max(0, countries.length - max);
  return (
    <span className={m.stack}>
      {countries.slice(0, max).map((c, i) => (
        <span key={c.iso} className={m.stackFlag} style={{ zIndex: max - i }}>
          <Flag code={c.flagCode} round diameter={size} decorative />
        </span>
      ))}
      {more ? <span className={m.stackMore}>+{more}</span> : null}
    </span>
  );
}

/** Пояси, що ще попереду (зокрема в ефірі), — за часом опівночі. */
export function upcomingZones(zones: readonly MapZone[], stateOf: (id: string) => ZoneState): MapZone[] {
  return zones.filter((z) => stateOf(z.id) !== 'past').sort((a, b) => a.midnightMs - b.midnightMs);
}

const QUEUE_ROWS = 6;

export interface MapQueueProps {
  zones: readonly MapZone[];
  stateOf: (id: string) => ZoneState;
  selectedId?: string;
  onSelect: (id: string) => void;
  /** Наведення на рядок підсвічує пояс на мапі. */
  onPreview: (id: string | null) => void;
  /** Скільки рядків черги (десктоп — 6, телефонна картка «Зараз» — 2). */
  limit?: number;
  /** Без «Вже зустріли» й точок міст (телефон: вони — у легенді нижче). */
  bare?: boolean;
}

/**
 * Десктоп, колонка біля мапи — «Північ по черзі» (рішення власника 2026-11-03, дошка `Desk-Map-Legend`, варіант C):
 * пояс в ефірі («Зараз»), наступний («Далі») і ще кілька — з прапорами й північчю за вашим часом; рядки самі пояснюють
 * кольори мапи, тож окремої легенди поясів немає. Рядок вибирає пояс. Унизу — «Вже зустріли» і точки міст.
 */
export function MapQueue({ zones, stateOf, selectedId, onSelect, onPreview, limit = QUEUE_ROWS, bare = false }: MapQueueProps) {
  const t = useTranslations('liveMap.queue');
  const tLegend = useTranslations('liveMap.legend');
  const locale = useLocale();
  const upcoming = upcomingZones(zones, stateOf);
  const rows = upcoming.slice(0, limit);
  const pastCount = zones.length - upcoming.length;
  return (
    <div className={m.queue} data-map-queue="">
      <div className={m.queueHead}>
        <span className={m.smallCap}>{t('title')}</span>
        <span className={m.queueHeadNote}>{t('yourTime')}</span>
      </div>
      <ul className={m.queueList} aria-label={t('title')}>
        {rows.map((z) => {
          const st = stateOf(z.id);
          const time = formatClock(z.midnightMs, { locale });
          const tag = st === 'live' ? t('now') : st === 'next' ? t('next') : null;
          return (
            <li key={z.id}>
              <button
                type="button"
                className={cn('t2f-focus', m.qRow, st === 'live' && m.qRowLive)}
                data-queue-zone={z.id}
                data-state={st}
                aria-pressed={selectedId === z.id}
                aria-label={
                  tag
                    ? t('rowAriaTag', { offset: utcLabel(z.offsetMinutes), tag, time })
                    : t('rowAria', { offset: utcLabel(z.offsetMinutes), time })
                }
                onClick={() => onSelect(z.id)}
                onPointerEnter={() => onPreview(z.id)}
                onPointerLeave={() => onPreview(null)}
                onFocus={() => onPreview(z.id)}
                onBlur={() => onPreview(null)}
              >
                <StateSwatch state={st} />
                <span className={m.qMain}>
                  <span className={m.qName}>
                    {utcLabel(z.offsetMinutes)}
                    {tag ? <span className={cn(m.smallCap, m.qTag, st === 'live' ? m.qTagLive : m.qTagNext)}>{tag}</span> : null}
                  </span>
                  <FlagStack countries={z.countries} max={3} size={16} />
                </span>
                <span className={cn(m.qTime, st === 'live' && m.qTimeLive)}>{time}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {pastCount && !bare ? (
        <div className={m.qPast} data-queue-past={pastCount}>
          <StateSwatch state="past" />
          {t('past', { count: pastCount })}
        </div>
      ) : null}
      {bare ? null : <MapCityKey className={m.qCities} label={tLegend('cities')} />}
    </div>
  );
}

/** Точки міст коротко: «Місто», «Трансляція» (правка власника 2026-11-03). */
export function MapCityKey({ className, label }: { className?: string; label: string }) {
  const t = useTranslations('liveMap.legend');
  return (
    <ul className={className} aria-label={label} data-map-city-key="">
      <li className={m.cityKey}>
        <span aria-hidden="true" className={m.cityKeyDot}>
          <span className="t2f-zm-dot-quiet t2f-zm-dot-legend size-2 rounded-full" />
        </span>
        {t('city')}
      </li>
      <li className={m.cityKey}>
        <span aria-hidden="true" className={m.cityKeyDot}>
          <span className="t2f-zm-halo size-2.5" />
          <span className="relative size-2.5 rounded-full bg-zone-live ring-2 ring-on-primary" />
        </span>
        {t('stream')}
      </li>
    </ul>
  );
}

/**
 * Телефон, під мапою — «Зараз» (рішення власника 2026-11-03: варіант A, редизайн у стилі черги десктопа): два рядки —
 * пояс в ефірі й наступний, з прапорами й північчю за вашим часом; дотик відкриває вікно поясу. Без відліку.
 */
export function MapNowCard({
  zones,
  stateOf,
  onSelect,
}: {
  zones: readonly MapZone[];
  stateOf: (id: string) => ZoneState;
  onSelect: (id: string) => void;
}) {
  if (!zones.some((z) => stateOf(z.id) === 'live')) return null;
  return (
    <div className={m.now} data-map-now="">
      <MapQueue zones={zones} stateOf={stateOf} onSelect={onSelect} onPreview={() => undefined} limit={2} bare />
    </div>
  );
}
