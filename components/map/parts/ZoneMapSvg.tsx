'use client';

// SVG-шари мапи поясів: океан, смуги й морські області, пояси суходолу, озера, кордони, лінія дат (`ZoneMap`).
// Порядок елементів = порядок малювання, не змінювати.
import { useTranslations } from 'next-intl';
import type { Dispatch, FocusEvent, KeyboardEvent, RefObject, SetStateAction } from 'react';
import { cn } from '@/components/primitives/cn';
import type { ZoneState } from '@/lib/engine/zoneState';
import type { MapZone, ZoneMapGeometry } from '@/lib/map/model';
import { ZoneGroup } from './ZoneGroup';
import { FILL_CLASS } from '@/components/map/zoneMapGeometry';
import type { Selection } from '@/components/map/hooks/useZoneMapSelection';

export function ZoneMapSvg({
  geometry,
  vb,
  uid,
  summary,
  zoneById,
  stateOf,
  hoverId,
  previewId,
  selectedZoneId,
  ringId,
  tabStop,
  hotCountry,
  pickedCountry,
  pathRefs,
  setSelection,
  setHoverId,
  setHotCountry,
  selectCountry,
  onZoneKeyDown,
  onZoneFocus,
  onZoneBlur,
}: {
  geometry: ZoneMapGeometry;
  vb: { x: number; y: number; w: number; h: number };
  uid: string;
  summary: string;
  zoneById: Map<string, MapZone>;
  stateOf: (id: string) => ZoneState;
  hoverId: string | null;
  previewId: string | null;
  selectedZoneId: string | undefined;
  ringId: string | null;
  tabStop: string | null;
  hotCountry: string | null;
  pickedCountry: string | null;
  pathRefs: RefObject<Map<string, SVGGElement>>;
  setSelection: Dispatch<SetStateAction<Selection>>;
  setHoverId: (id: string | null) => void;
  setHotCountry: (key: string | null) => void;
  selectCountry: (zoneId: string, iso: string) => void;
  onZoneKeyDown: (e: KeyboardEvent<SVGGElement>, id: string) => void;
  onZoneFocus: (e: FocusEvent<SVGGElement>, id: string) => void;
  onZoneBlur: () => void;
}) {
  const t = useTranslations('liveMap');
  return (
    <svg
      viewBox={`${vb.x} ${vb.y} ${vb.w} ${vb.h}`}
      role="group"
      aria-label={summary ? `${t('mapGroup')}. ${summary}` : t('mapGroup')}
      aria-describedby={`${uid}-hint`}
      data-zone-map-svg=""
      className="block size-full"
    >
      <rect width={geometry.meta.width} height={geometry.meta.height} className="t2f-zm-ocean" />
      {/* Нижній шар: смуги поясів в океані й морські області острівних країн. Вони йдуть і під суходолом, тож лежать
          під усіма поясами — суходіл перекриває їх і для ока, і для курсора. */}
      <g aria-hidden="true">
        {geometry.zones.map((g) =>
          zoneById.has(g.zoneId) && (g.band || g.sea?.length) ? (
            <g
              key={`bg-${g.zoneId}`}
              className={cn('t2f-zone-bg', FILL_CLASS[stateOf(g.zoneId)])}
              data-hover={hoverId === g.zoneId || previewId === g.zoneId ? 'true' : undefined}
              data-selected={
                selectedZoneId === g.zoneId || ringId === g.zoneId ? 'true' : undefined
              }
              onClick={() => setSelection({ kind: 'zone', id: g.zoneId })}
            >
              {g.band ? (
                <path
                  d={g.band}
                  className="t2f-zone-band"
                  data-zone-band={g.zoneId}
                  onPointerEnter={() => setHoverId(g.zoneId)}
                  onPointerLeave={() => setHoverId(null)}
                />
              ) : null}
              {g.sea?.map((s, i) => (
                <path
                  key={`sea-${s.iso}-${i}`}
                  d={s.d}
                  data-iso={s.iso}
                  data-hot={
                    hotCountry === `${g.zoneId}:${s.iso}` ||
                    pickedCountry === `${g.zoneId}:${s.iso}`
                      ? 'true'
                      : undefined
                  }
                  className="t2f-zone-sea"
                  onClick={(e) => {
                    e.stopPropagation();
                    selectCountry(g.zoneId, s.iso);
                  }}
                  onPointerEnter={() => {
                    setHoverId(g.zoneId);
                    setHotCountry(`${g.zoneId}:${s.iso}`);
                  }}
                  onPointerLeave={() => {
                    setHoverId(null);
                    setHotCountry(null);
                  }}
                />
              ))}
            </g>
          ) : null,
        )}
      </g>
      {/* Пояси — групи суходолу (країни й області островів). Наведення й вибір — лише колір. */}
      <g>
        {geometry.zones.map((g) => {
          const zone = zoneById.get(g.zoneId);
          if (!zone || g.countries.length === 0) return null;
          const state = stateOf(g.zoneId);
          return (
            <ZoneGroup
              key={g.zoneId}
              g={g}
              zone={zone}
              state={state}
              tabbable={tabStop === g.zoneId}
              selected={selectedZoneId === g.zoneId}
              focused={ringId === g.zoneId}
              hovered={hoverId === g.zoneId || previewId === g.zoneId}
              hotCountry={hotCountry}
              pickedCountry={pickedCountry}
              onHotCountry={setHotCountry}
              onSelectCountry={(iso) => selectCountry(g.zoneId, iso)}
              areas={geometry.areas?.filter((a) => a.zoneId === g.zoneId)}
              pathRefs={pathRefs}
              onKeyDown={onZoneKeyDown}
              onFocus={onZoneFocus}
              onBlur={onZoneBlur}
              onSelect={() => setSelection({ kind: 'zone', id: g.zoneId })}
              onHover={setHoverId}
            />
          );
        })}
      </g>
      {geometry.lakes ? <path d={geometry.lakes} className="t2f-zm-lakes" /> : null}
      {geometry.sea ? <path d={geometry.sea} className="t2f-zm-sea" /> : null}
      {geometry.borders ? <path d={geometry.borders} className="t2f-zm-borders" /> : null}
      {geometry.zoneLines ? <path d={geometry.zoneLines} className="t2f-zm-zlines" /> : null}
      {geometry.dayline ? <path d={geometry.dayline} className="t2f-zm-dayline" /> : null}
    </svg>
  );
}
