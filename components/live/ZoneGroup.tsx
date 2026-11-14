'use client';

// Один пояс на мапі: група шляхів суходолу (країни й області островів) з наведенням, фокусом і вибором (`ZoneMapSvg`).
import { useTranslations } from 'next-intl';
import type { FocusEvent, KeyboardEvent, RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import type { ZoneState } from '@/lib/engine/zoneState';
import type { MapZone, ZoneMapGeometry } from './MapModel';
import { useMidnightPhrase } from './ZoneMapCards';
import { FILL_CLASS } from './zoneMapGeometry';

export interface ZoneGroupProps {
  g: ZoneMapGeometry['zones'][number];
  zone: MapZone;
  state: ZoneState;
  tabbable: boolean;
  selected: boolean;
  /** Фокус з клавіатури: підсвітка кольором, як у вибраного (без обвідки). */
  focused: boolean;
  /** Пояс під курсором (зокрема через смугу в океані чи морську область). */
  hovered: boolean;
  hotCountry: string | null;
  /** Країна, чиє вікно відкрите (`zoneId:iso`). */
  pickedCountry: string | null;
  onHotCountry: (key: string | null) => void;
  /** Клік по суші країни (чи області її островів) — вікно країни. */
  onSelectCountry: (iso: string) => void;
  /** Області дрібних островів поясу (рамка) — частина країни, як її морська область. */
  areas?: NonNullable<ZoneMapGeometry['areas']>;
  pathRefs: RefObject<Map<string, SVGGElement>>;
  onKeyDown: (e: KeyboardEvent<SVGGElement>, id: string) => void;
  onFocus: (e: FocusEvent<SVGGElement>, id: string) => void;
  onBlur: () => void;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}

/**
 * Один пояс — група: смуга в океані, морські області острівних країн і країни (окремі шляхи). Наведення на будь-яку
 * частину підсвічує весь пояс кольором; країна під курсором (чи її морська область) — ще сильніше. Кордони не
 * виділяються. Доступна назва — країни, час і стан (без UTC).
 */
export function ZoneGroup({
  g,
  zone,
  state,
  tabbable,
  selected,
  focused,
  hovered,
  hotCountry,
  pickedCountry,
  onHotCountry,
  onSelectCountry,
  areas,
  pathRefs,
  onKeyDown,
  onFocus,
  onBlur,
  onSelect,
  onHover,
}: ZoneGroupProps) {
  const t = useTranslations('liveMap');
  const when = useMidnightPhrase(zone.midnightMs);
  const label = t('zoneAria', {
    when,
    countries: zone.countries
      .slice(0, 3)
      .map((c) => c.name)
      .join(', '),
    state: t(`state.${state}`),
  });
  const hot = (iso: string) =>
    hotCountry === `${g.zoneId}:${iso}` || pickedCountry === `${g.zoneId}:${iso}`;
  const pick = (iso: string) => (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    onSelectCountry(iso);
  };
  const enter = (iso: string) => () => onHotCountry(`${g.zoneId}:${iso}`);
  const leave = () => onHotCountry(null);
  return (
    <g
      ref={(el) => {
        if (el) pathRefs.current.set(g.zoneId, el);
        else pathRefs.current.delete(g.zoneId);
      }}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-offset={g.offset}
      data-zone={g.zoneId}
      data-state={state}
      data-selected={selected || focused ? 'true' : undefined}
      data-hover={hovered ? 'true' : undefined}
      className={cn('t2f-zone', FILL_CLASS[state])}
      onClick={onSelect}
      onKeyDown={(e) => onKeyDown(e, g.zoneId)}
      onFocus={(e) => onFocus(e, g.zoneId)}
      onBlur={onBlur}
      onPointerEnter={() => onHover(g.zoneId)}
      onPointerLeave={() => onHover(null)}
    >
      {g.countries.map((c, i) => (
        <path
          key={`${c.iso}-${i}`}
          d={c.d}
          data-iso={c.iso}
          data-hot={hot(c.iso) ? 'true' : undefined}
          className="t2f-zone-land"
          fillRule="evenodd"
          onClick={pick(c.iso)}
          onPointerEnter={enter(c.iso)}
          onPointerLeave={leave}
        />
      ))}
      {areas?.map((a) => (
        <rect
          key={`area-${a.x0}`}
          x={a.x0}
          y={a.y0}
          width={a.x1 - a.x0}
          height={a.y1 - a.y0}
          rx={a.frame ? 3 : 0}
          data-zone-area={a.zoneId}
          data-iso={a.iso}
          data-frame={a.frame ? 'true' : 'false'}
          data-hot={hot(a.iso) ? 'true' : undefined}
          className="t2f-zm-area"
          onClick={pick(a.iso)}
          onPointerEnter={enter(a.iso)}
          onPointerLeave={leave}
        />
      ))}
    </g>
  );
}
