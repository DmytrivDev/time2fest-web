'use client';

import { useTranslations } from 'next-intl';
import { useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/components/primitives/cn';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { zoneState, type ZoneState } from '@time2fest/rules/time';
import { useNow } from '@/lib/time/TimeProvider';
import { MapLegend } from './parts/MapLegend';
import { MapGestureHint } from './parts/MapGestureHint';
import { MapNowCard } from './MapSide';
import type { MapCity, MapCountry, MapZone, ZoneMapGeometry } from '@/lib/map/model';
import { ZoneListView } from './ZoneListView';
import { MapScheduleContext } from './MapStreamCard';
import { usePhone } from '@/lib/hooks/useMedia';
import { MIN_K, useMapZoom } from './hooks/useMapZoom';
import { placeOnMap, viewBoxOf } from './zoneMapGeometry';
import { useGeometry } from './hooks/useZoneMapGeometry';
import { useZoneMapSelection, useZoneMapCard } from './hooks/useZoneMapSelection';
import { useZoneMapKeyboard } from './hooks/useZoneMapKeyboard';
import { useZoneMapTip } from './hooks/useZoneMapTip';
import { ZoneMapSvg } from './parts/ZoneMapSvg';
import { ZoneMapOverlay } from './parts/ZoneMapOverlay';
import { ZoneMapTipView } from './parts/ZoneMapTipView';
import { ZoneMapZoomControls } from './parts/ZoneMapZoomControls';
import { ZoneMapCardSlot } from './parts/ZoneMapCardSlot';
import { MapPrefestContext, type MapPrefest } from './mapPrefest';
import './ZoneMap.css';
import m from './zoneMap.module.css';

export { MapLegend } from './parts/MapLegend';

export interface ZoneMapProps {
  zones: readonly MapZone[];
  cities: readonly MapCity[];
  /**
   * `phone` — дотик до міста відкриває картку під мапою (переходу немає) ·
   * `desktop` — точка міста веде на сторінку країни. За замовчуванням — за шириною вікна.
   */
  layout?: 'phone' | 'desktop';
  defaultView?: 'map' | 'list';
  /** Вибраний пояс на старті (картка поясу вже відкрита). */
  defaultSelectedZoneId?: string;
  /** Геометрія (`data/zonemap.json`); без неї підвантажується окремим шматком, поки показано скелетон. */
  geometry?: ZoneMapGeometry;
  /** «Додати в графік» на картках трансляцій, що ще попереду (як на картках «Зараз і далі»); без неї календарика немає. */
  onToggleSchedule?: (eventId: string, next: boolean) => void;
  /** Без своєї шапки («Мапа поясів» і «Мапа | Список»): лише мапа (сторінка «Країни й міста» має перемикач угорі). */
  headless?: boolean;
  /**
   * Мапа «до свята» (головна `/before`): без трансляцій, кімнат, штампів і графіка у вікнах і легенді
   * (`components/map/mapPrefest.ts`). Не задано — жива мапа.
   */
  prefest?: MapPrefest;
  className?: string;
}

/**
 * C18. Мапа поясів (вигляд «смуги поясів», рішення власника 2026-11-02): пояс — суцільна смуга від полюса до полюса
 * (океан у смузі ледь тонований кольором стану, суходіл — повним кольором), тонкі темні межі поясів, кордони країн —
 * розриви, у морі між острівними країнами — крапки. Масштаб і переміщення — `useMapZoom` (колесо, перетягування, щипок,
 * кнопки). Пояси (колір + іконка + підпис), точки 20 міст, легенда,
 * `ZoneCard` (Enter на поясі) і `MapTapCard` (дотик до міста на телефоні). Стани поясів — від `zoneState`
 * та `useNow`. Один Tab-стоп на всю мапу, стрілки — між поясами, Esc закриває картку й повертає фокус.
 */
export function ZoneMap({
  zones,
  cities,
  layout: layoutProp,
  defaultView = 'map',
  defaultSelectedZoneId,
  geometry: geometryProp,
  onToggleSchedule,
  headless = false,
  prefest,
  className,
}: ZoneMapProps) {
  const t = useTranslations('liveMap');
  const tNav = useTranslations('nav');
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const headId = `${uid}-head`;
  const cardId = `${uid}-card`;

  const phoneQuery = usePhone();
  const layout = layoutProp ?? (phoneQuery ? 'phone' : 'desktop');
  const isPhone = layout === 'phone';

  const now = useNow({ granularity: 'minute' });
  const rootRef = useRef<HTMLElement>(null);
  const { geometry, failed } = useGeometry(geometryProp, rootRef);

  const [view, setView] = useState<'map' | 'list'>(defaultView);
  // Пояс під курсором (суходіл, смуга в океані чи морська область): підсвічується весь пояс.
  const [hoverId, setHoverId] = useState<string | null>(null);
  // Країна під курсором (суходіл або її морська область): `zoneId:iso` — підсвічується сильніше за свій пояс.
  const [hotCountry, setHotCountry] = useState<string | null>(null);
  // Місто під курсором: його пояс і країна лишаються підсвіченими, плашка — міста (дошка `Desk-Map-CityTips`).
  const [onCity, setOnCity] = useState<string | null>(null);
  // Підсвітка поясу з рядка черги — черги біля мапи більше немає (рішення 2026-11-04).
  const previewId: string | null = null;
  const cardRef = useRef<HTMLElement>(null);

  const ordered = useMemo(
    () => [...zones].sort((a, b) => a.offsetMinutes - b.offsetMinutes),
    [zones],
  );
  const zoneById = useMemo(() => new Map(zones.map((z) => [z.id, z])), [zones]);
  const countryByIso = useMemo(() => {
    const m = new Map<string, MapCountry>();
    for (const z of zones) for (const c of z.countries) if (!m.has(c.iso)) m.set(c.iso, c);
    return m;
  }, [zones]);
  const states = useMemo(() => {
    const m = new Map<string, ZoneState>();
    for (const z of zones) m.set(z.id, now > 0 ? zoneState(now, z, zones) : 'future');
    return m;
  }, [zones, now]);
  const stateOf = (id: string): ZoneState => states.get(id) ?? 'future';
  // Скільки поясів у країни (плашка: «UTC+3 · ще 10 поясів»).
  const zoneCountByIso = useMemo(() => {
    const m = new Map<string, number>();
    for (const z of zones) for (const c of z.countries) m.set(c.iso, (m.get(c.iso) ?? 0) + 1);
    return m;
  }, [zones]);

  const liveZoneId = ordered.find((z) => stateOf(z.id) === 'live')?.id;

  const { selection, setSelection, selectedZoneId, pickedCountry, selectCountry } =
    useZoneMapSelection(cities, defaultSelectedZoneId);
  const {
    tabStop,
    ringId,
    pathRefs,
    dotRefs,
    onZoneKeyDown,
    onZoneFocus,
    onZoneBlur,
    closeSelection,
    onRootKeyDown,
  } = useZoneMapKeyboard({ ordered, zoneById, liveZoneId, selection, setSelection });

  const aspect = geometry ? geometry.meta.width / geometry.meta.height : 1781 / 911;
  const boxRef = useRef<HTMLDivElement>(null);
  const { view: zoom, box, zoomIn, zoomOut, reset } = useMapZoom(boxRef, Boolean(geometry));
  const zoomed = zoom.k > MIN_K + 0.01;
  const mw = geometry?.meta.width ?? 1781;
  const mh = geometry?.meta.height ?? 911;
  const vb = viewBoxOf(zoom, box, mw, mh);
  const place = (leftPct: number, topPct: number) => placeOnMap(zoom, box, leftPct, topPct);
  // Назви міст біля точок — від наближення ×2.
  const showNames = zoom.k >= 2;

  const { tip, tipRef, tipZone, tipCity, tipCountry, tipStyle } = useZoneMapTip({
    isPhone,
    cities,
    hoverId,
    hotCountry,
    onCity,
    ringId,
    zoneById,
    countryByIso,
    geometry,
    place,
    boxRef,
  });

  const liveZone = ordered.find((z) => stateOf(z.id) === 'live');
  const summary = liveZone
    ? `${liveZone.countries
        .slice(0, 3)
        .map((c) => c.name)
        .join(', ')} · ${t('state.live')}`
    : '';

  const { slotRef, panelZone, panelCountry } = useZoneMapCard(selection, selectedZoneId, zoneById);
  const cardSlot = (
    <ZoneMapCardSlot
      slotRef={slotRef}
      cardRef={cardRef}
      cardId={cardId}
      panelZone={panelZone}
      panelCountry={panelCountry}
      open={Boolean(selectedZoneId)}
      ordered={ordered}
      stateOf={stateOf}
      now={now}
      isPhone={isPhone}
      selection={selection}
      setSelection={setSelection}
      selectCountry={selectCountry}
      closeSelection={closeSelection}
    />
  );
  const hint = (
    // Підказка лише для читачів екрана: на десктопі колонку займає черга поясів, на телефоні — «Зараз» і легенда.
    <p id={`${uid}-hint`} className="sr-only">
      {isPhone ? t('hintPhone') : t('hintDesktop')}
    </p>
  );

  const canvas = !geometry ? (
    failed ? (
      <StatusMessage kind="error">{t('loadError')}</StatusMessage>
    ) : (
      <div aria-busy="true" style={{ aspectRatio: aspect }}>
        <Skeleton variant="block" className="size-full rounded-md" />
        <span className="sr-only">{t('loading')}</span>
      </div>
    )
  ) : (
    <div
      ref={boxRef}
      className={m.mapBox}
      data-zone-map-scroll=""
      data-zoomed={zoomed ? 'true' : 'false'}
      style={{ aspectRatio: aspect }}
    >
      <div className={m.stage} data-zone-map-stage="">
        <ZoneMapSvg
          geometry={geometry}
          vb={vb}
          uid={uid}
          summary={summary}
          zoneById={zoneById}
          stateOf={stateOf}
          hoverId={hoverId}
          previewId={previewId}
          selectedZoneId={selectedZoneId}
          ringId={ringId}
          tabStop={tabStop}
          hotCountry={hotCountry}
          pickedCountry={pickedCountry}
          pathRefs={pathRefs}
          setSelection={setSelection}
          setHoverId={setHoverId}
          setHotCountry={setHotCountry}
          selectCountry={selectCountry}
          onZoneKeyDown={onZoneKeyDown}
          onZoneFocus={onZoneFocus}
          onZoneBlur={onZoneBlur}
        />
        <ZoneMapOverlay
          geometry={geometry}
          cities={cities}
          countryByIso={countryByIso}
          stateOf={stateOf}
          place={place}
          isPhone={isPhone}
          showNames={showNames}
          cardId={cardId}
          dotRefs={dotRefs}
          pickedCountry={pickedCountry}
          selectCountry={selectCountry}
          setOnCity={setOnCity}
          setHoverId={setHoverId}
          setHotCountry={setHotCountry}
        />
      </div>
      <ZoneMapTipView
        tip={tip}
        tipRef={tipRef}
        tipZone={tipZone}
        tipCity={tipCity}
        tipCountry={tipCountry}
        tipStyle={tipStyle}
        countryByIso={countryByIso}
        zoneCountByIso={zoneCountByIso}
        stateOf={stateOf}
        now={now}
      />
      {/* Телефон: кнопок масштабу немає — два пальці (рішення власника 2026-11-03); один раз — підказка жестів. */}
      {isPhone ? (
        <MapGestureHint boxRef={boxRef} />
      ) : (
        <ZoneMapZoomControls
          k={zoom.k}
          zoomed={zoomed}
          zoomIn={zoomIn}
          zoomOut={zoomOut}
          reset={reset}
        />
      )}
    </div>
  );

  return (
    <MapPrefestContext.Provider value={prefest ?? null}>
    <MapScheduleContext.Provider value={prefest ? null : (onToggleSchedule ?? null)}>
      {/* Esc із будь-якого місця мапи й картки закриває картку (клавіатурний прийом, не окрема дія). */}
      {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */}
      <section
        ref={rootRef}
        aria-labelledby={headId}
        data-zone-map=""
        data-layout={layout}
        onKeyDown={onRootKeyDown}
        className={cn(m.section, className)}
      >
        <div className={headless ? 'sr-only' : m.head}>
          <h2 id={headId} className={cn('t2f-h2', m.title)}>
            {tNav('map')}
          </h2>
          <div className={headless ? 'hidden' : m.controls}>
            {/* «Пояси · Звідки дивляться» прибрано (рішення власника 2026-11-03): лишається «Мапа | Список». */}
            <SegmentedControl
              semantics="pressed"
              label={t('viewLabel')}
              value={view}
              onValueChange={(v) => setView(v as 'map' | 'list')}
              options={[
                { value: 'map', label: tNav('mapShort') },
                { value: 'list', label: tNav('list') },
              ]}
            />
          </div>
        </div>

        {view === 'map' ? (
          isPhone ? (
            <>
              <div className={m.canvas} data-zone-map-canvas="">
                {canvas}
                {/* Легенда — у тій самій рамці, одразу під мапою (дошка `Phone-Map-Legend`, варіант A). */}
                <MapLegend variant="inMap" className={m.legendInMap} />
                {hint}
              </div>
              {cardSlot}
              {/* Вибрано пояс — картки «Зараз» немає: вікно поясу стоїть одразу під мапою (правка власника 2026-11-03). */}
              {selectedZoneId ? null : (
                <MapNowCard
                  zones={ordered}
                  stateOf={stateOf}
                  onSelect={(id) => setSelection({ kind: 'zone', id })}
                />
              )}
            </>
          ) : (
            // Десктоп: мапа на всю ширину блоку, легенда — рядком під нею (рішення власника 2026-11-04); черга — у «Списку».
            <div className={m.canvas} data-zone-map-canvas="">
              {canvas}
              <MapLegend variant="row" className={m.legendRow} />
              {hint}
            </div>
          )
        ) : (
          <ZoneListView zones={ordered} stateOf={stateOf} phone={isPhone} />
        )}

        {/* Вікно поясу чи країни з мапи — лише у вигляді «Мапа»; у «Списку» пояс розгортається у своєму рядку. */}
        {view === 'map' && !isPhone ? cardSlot : null}
      </section>
    </MapScheduleContext.Provider>
    </MapPrefestContext.Provider>
  );
}
