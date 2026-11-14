'use client';

// Шар поверх SVG мапи поясів: маркери й іконки поясів, точки міст, назви міст (`ZoneMap`). Координати — у відсотках рамки.
import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import type { RefObject } from 'react';
import { cn } from '@/components/primitives/cn';
import type { ZoneState } from '@/lib/engine/zoneState';
import { pointToPercent, type MapCity, type MapCountry, type ZoneMapGeometry } from '@/lib/map/model';
import { MARKER_CLASS } from '@/components/map/zoneMapGeometry';
import m from '@/components/map/zoneMap.module.css';

export function ZoneMapOverlay({
  geometry,
  cities,
  countryByIso,
  stateOf,
  place,
  isPhone,
  showNames,
  cardId,
  dotRefs,
  pickedCountry,
  selectCountry,
  setOnCity,
  setHoverId,
  setHotCountry,
}: {
  geometry: ZoneMapGeometry;
  cities: readonly MapCity[];
  countryByIso: Map<string, MapCountry>;
  stateOf: (id: string) => ZoneState;
  place: (leftPct: number, topPct: number) => { left: string; top: string };
  isPhone: boolean;
  showNames: boolean;
  cardId: string;
  dotRefs: RefObject<Map<string, HTMLElement>>;
  pickedCountry: string | null;
  selectCountry: (zoneId: string, iso: string) => void;
  setOnCity: (id: string | null) => void;
  setHoverId: (id: string | null) => void;
  setHotCountry: (key: string | null) => void;
}) {
  const t = useTranslations('liveMap');
  return (
    <div className="pointer-events-none absolute inset-0" data-zone-map-overlay="">
      {geometry.markers.map((mk) => {
        const pos = place((mk.x / geometry.meta.width) * 100, (mk.y / geometry.meta.height) * 100);
        return (
          <span
            key={mk.zoneId}
            aria-hidden="true"
            data-zone-marker={mk.zoneId}
            className={cn(
              'absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border',
              MARKER_CLASS[stateOf(mk.zoneId)],
            )}
            style={pos}
          />
        );
      })}
      {geometry.zones.map((g) => {
        const st = stateOf(g.zoneId);
        if (st !== 'live' && st !== 'next') return null;
        return (
          <span
            key={`icon-${g.zoneId}`}
            aria-hidden="true"
            data-zone-icon={st}
            className="absolute -translate-x-1/2 -translate-y-1/2 text-on-highlight"
            style={place(
              (g.label[0] / geometry.meta.width) * 100,
              (g.label[1] / geometry.meta.height) * 100,
            )}
          >
            {st === 'live' ? (
              <span className="block size-1.5 rounded-full bg-background" />
            ) : (
              <svg
                viewBox="0 0 24 24"
                width="10"
                height="10"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M12 7v5l3 2" />
              </svg>
            )}
          </span>
        );
      })}
      {cities.map((city) => {
        const country = countryByIso.get(city.countryIso);
        const st = stateOf(city.zoneId);
        const onAir = city.stream === 'live' && st === 'live';
        const pos = pointToPercent(city, geometry.meta);
        const label = isPhone
          ? t(onAir ? 'cityAriaStreamCard' : 'cityAriaQuietCard', { city: city.name })
          : t(onAir ? 'cityAriaStreamLink' : 'cityAriaQuietLink', { city: city.name });
        const dot = (
          <span aria-hidden="true" className="relative inline-flex items-center justify-center">
            {onAir ? (
              <>
                <span className="t2f-zm-halo size-2.5" />
                <span
                  className="t2f-zm-dot-live relative size-2.5 rounded-full bg-zone-live"
                  data-city-dot="live"
                />
              </>
            ) : (
              <span className="t2f-zm-dot-quiet size-2 rounded-full" data-city-dot="quiet" />
            )}
          </span>
        );
        // Невидима зона точки: на десктопі 20 px (не закриває країну), на телефоні — 44 px під палець.
        const cls = cn(
          't2f-focus pointer-events-auto absolute flex -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full',
          isPhone ? 'size-11' : 'size-5',
        );
        const style = place(pos.left, pos.top);
        const cityHover = {
          onPointerEnter: (e: { pointerType: string }) => {
            if (e.pointerType !== 'mouse') return;
            setOnCity(city.id);
            setHoverId(city.zoneId);
            setHotCountry(`${city.zoneId}:${city.countryIso}`);
          },
          onPointerLeave: (e: { pointerType: string }) => {
            if (e.pointerType !== 'mouse') return;
            setOnCity(null);
            setHoverId(null);
            setHotCountry(null);
          },
        };
        // Десктоп: де трансляція йде чи є повтор — одразу на сторінку країни; де ще буде чи лише відлік — вікно країни
        // під мапою (рішення власника 2026-11-03). Телефон — завжди вікно країни.
        if (!isPhone && country && city.stream === 'live' && (st === 'live' || st === 'past')) {
          return (
            <NextLink
              key={city.id}
              href={country.href}
              aria-label={label}
              tabIndex={-1}
              data-city={city.id}
              className={cls}
              style={style}
              {...cityHover}
            >
              {dot}
            </NextLink>
          );
        }
        return (
          <button
            key={city.id}
            type="button"
            ref={(el) => {
              if (el) dotRefs.current.set(city.id, el);
              else dotRefs.current.delete(city.id);
            }}
            aria-label={label}
            aria-expanded={pickedCountry === `${city.zoneId}:${city.countryIso}`}
            aria-controls={cardId}
            tabIndex={-1}
            data-city={city.id}
            className={cn(cls, 'z-10')}
            style={style}
            {...cityHover}
            onClick={() => selectCountry(city.zoneId, city.countryIso)}
          >
            {dot}
          </button>
        );
      })}
      {showNames
        ? cities.map((c) => {
            const pos = pointToPercent(c, geometry.meta);
            return (
              <span
                key={`name-${c.id}`}
                aria-hidden="true"
                data-city-name={c.id}
                className={m.cityName}
                style={place(pos.left, pos.top)}
              >
                {c.name}
              </span>
            );
          })
        : null}
    </div>
  );
}
