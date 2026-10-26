'use client';

import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type FocusEvent,
  type KeyboardEvent,
  type RefObject,
} from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { IconButton } from '@/components/primitives/IconButton';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { zoneState, type ZoneState } from '@/lib/engine/zoneState';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { MapLegend } from './MapLegend';
import {
  pointToPercent,
  type MapCity,
  type MapCountry,
  type MapZone,
  type ZoneMapGeometry,
} from './MapModel';
import { MapTapCard, ZoneCard, ZoneStateLabel, useMidnightPhrase } from './ZoneMapCards';
import './ZoneMap.css';

export { MapLegend } from './MapLegend';
export { HowToPopover, MapTapCard, ZoneCard } from './ZoneMapCards';

export interface MapViewer {
  iso: string;
  name: string;
  flagCode: string;
}

export interface ZoneMapProps {
  zones: readonly MapZone[];
  cities: readonly MapCity[];
  /** Країни, звідки дивляться; без них шару «Звідки дивляться» немає. */
  viewers?: readonly MapViewer[];
  /**
   * `phone` — дотик до міста відкриває картку під мапою (переходу немає) ·
   * `desktop` — точка міста веде на сторінку країни. За замовчуванням — за шириною вікна.
   */
  layout?: 'phone' | 'desktop';
  defaultView?: 'map' | 'list';
  defaultLayer?: 'zones' | 'viewers';
  /** Вибраний пояс на старті (картка поясу вже відкрита). */
  defaultSelectedZoneId?: string;
  /** Геометрія (`data/zonemap.json`); без неї підвантажується окремим шматком, поки показано скелетон. */
  geometry?: ZoneMapGeometry;
  className?: string;
}

type Selection = { kind: 'zone'; id: string } | { kind: 'city'; id: string } | null;

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;
const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;
const PHONE_QUERY = '(max-width: 767.98px)';

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getPhone = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false);

function useGeometry(initial: ZoneMapGeometry | undefined) {
  const [loaded, setLoaded] = useState<ZoneMapGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    import('@/data/zonemap.json')
      .then((m) => {
        if (alive) setLoaded(m.default as unknown as ZoneMapGeometry);
      })
      .catch(() => {
        if (alive) setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [initial]);
  return { geometry: initial ?? loaded, failed };
}

const FILL_CLASS: Record<ZoneState, string> = { past: 'is-past', live: 'is-live', next: 'is-next', future: 'is-ahead' };
const MARKER_CLASS: Record<ZoneState, string> = {
  past: 'bg-zone-past border-border-strong',
  live: 'bg-zone-live border-background',
  next: 'bg-zone-next border-background',
  future: 'bg-zone-future border-background',
};

/**
 * C18. Мапа поясів: пояси (колір + штрихування + іконка + підпис), точки основних міст, масштаб, легенда,
 * `ZoneCard` (Enter на поясі) і `MapTapCard` (дотик до міста на телефоні). Стани поясів — від `zoneState`
 * та `useNow`. Один Tab-стоп на всю мапу, стрілки — між поясами, Esc закриває картку й повертає фокус.
 */
export function ZoneMap({
  zones,
  cities,
  viewers,
  layout: layoutProp,
  defaultView = 'map',
  defaultLayer = 'zones',
  defaultSelectedZoneId,
  geometry: geometryProp,
  className,
}: ZoneMapProps) {
  const t = useTranslations('liveMap');
  const tNav = useTranslations('nav');
  const tType = useTranslations('liveCards.eventCard.type');
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const headId = `${uid}-head`;
  const cardId = `${uid}-card`;

  const phoneQuery = useSyncExternalStore(subscribePhone, getPhone, () => false);
  const layout = layoutProp ?? (phoneQuery ? 'phone' : 'desktop');
  const isPhone = layout === 'phone';

  const now = useNow({ granularity: 'minute' });
  const { geometry, failed } = useGeometry(geometryProp);

  const [view, setView] = useState<'map' | 'list'>(defaultView);
  const [layer, setLayer] = useState<'zones' | 'viewers'>(defaultLayer);
  const [zoomIdx, setZoomIdx] = useState(0);
  const [selection, setSelection] = useState<Selection>(
    defaultSelectedZoneId ? { kind: 'zone', id: defaultSelectedZoneId } : null,
  );
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const [tabStopId, setTabStopId] = useState<string | null>(null);

  const pathRefs = useRef(new Map<string, SVGPathElement>());
  const dotRefs = useRef(new Map<string, HTMLElement>());
  const cardRef = useRef<HTMLElement>(null);

  const ordered = useMemo(() => [...zones].sort((a, b) => a.offsetMinutes - b.offsetMinutes), [zones]);
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

  const liveZoneId = ordered.find((z) => stateOf(z.id) === 'live')?.id;
  const tabStop = tabStopId && zoneById.has(tabStopId) ? tabStopId : (liveZoneId ?? ordered[0]?.id ?? null);

  const selectedZoneId = selection?.kind === 'zone' ? selection.id : selection?.kind === 'city' ? cities.find((c) => c.id === selection.id)?.zoneId : undefined;
  const selectedCity = selection?.kind === 'city' ? cities.find((c) => c.id === selection.id) : undefined;

  function focusZone(id: string) {
    setTabStopId(id);
    pathRefs.current.get(id)?.focus();
  }

  function onZoneKeyDown(e: KeyboardEvent<SVGPathElement>, id: string) {
    const i = ordered.findIndex((z) => z.id === id);
    let target: number | null = null;
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowUp':
        target = Math.min(ordered.length - 1, i + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowDown':
        target = Math.max(0, i - 1);
        break;
      case 'Home':
        target = 0;
        break;
      case 'End':
        target = ordered.length - 1;
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        setSelection({ kind: 'zone', id });
        return;
      default:
        return;
    }
    e.preventDefault();
    const next = ordered[target];
    if (!next) return;
    // Відкрита картка поясу йде за фокусом: стрілками можна гортати пояси.
    if (selection?.kind === 'zone') setSelection({ kind: 'zone', id: next.id });
    focusZone(next.id);
  }

  function onZoneFocus(e: FocusEvent<SVGPathElement>, id: string) {
    setTabStopId(id);
    setFocusedId(id);
    let visible = true;
    try {
      visible = e.currentTarget.matches(':focus-visible');
    } catch {
      visible = true;
    }
    setRingId(visible ? id : null);
  }

  function closeSelection() {
    const prev = selection;
    setSelection(null);
    if (prev?.kind === 'zone') {
      focusZone(prev.id);
      // Esc закриває картку зовсім: фокус повертається на пояс без картки-прев’ю (вона з’явиться з наступним рухом фокуса).
      setFocusedId(null);
    }
    else if (prev?.kind === 'city') dotRefs.current.get(prev.id)?.focus();
  }

  function onRootKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.key !== 'Escape' || e.defaultPrevented || !selection) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    e.preventDefault();
    closeSelection();
  }

  const aspect = geometry ? geometry.meta.width / geometry.meta.height : 2.6;
  const zoom = ZOOM_STEPS[zoomIdx] ?? 1;
  const hatchId = `${uid}-hatch`;

  const previewId = !selection && !isPhone ? (hoverId ?? focusedId) : null;
  const previewZone = previewId ? zoneById.get(previewId) : undefined;
  const pinnedZone = selectedZoneId ? zoneById.get(selectedZoneId) : undefined;

  const liveZone = ordered.find((z) => stateOf(z.id) === 'live');
  const summary = liveZone ? `${liveZone.countries.slice(0, 3).map((c) => c.name).join(', ')} · ${t('state.live')}` : '';

  return (
    // Esc із будь-якого місця мапи й картки закриває картку (клавіатурний прийом, не окрема дія).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      aria-labelledby={headId}
      data-zone-map=""
      data-layout={layout}
      onKeyDown={onRootKeyDown}
      className={cn('flex flex-col gap-2', className)}
    >
      <SectionHeader id={headId} title={tNav('map')} />

      <div className="flex flex-wrap justify-between gap-2">
        {viewers && viewers.length > 0 ? (
          <SegmentedControl
            semantics="pressed"
            label={t('layerLabel')}
            value={layer}
            onValueChange={(v) => setLayer(v as 'zones' | 'viewers')}
            options={[
              { value: 'zones', label: tNav('zones') },
              { value: 'viewers', label: tNav('viewersFrom') },
            ]}
          />
        ) : (
          <span />
        )}
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

      {view === 'map' ? (
        <div className="flex flex-col gap-2 rounded-lg bg-surface p-2.5" data-zone-map-canvas="">
          {geometry ? (
            <div className="flex justify-end gap-1">
              <IconButton
                icon="minus"
                variant="ring"
                compact
                aria-label={tNav('zoomOut')}
                disabled={zoomIdx === 0}
                onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              />
              <IconButton
                icon="plus"
                variant="ring"
                compact
                aria-label={tNav('zoomIn')}
                disabled={zoomIdx === ZOOM_STEPS.length - 1}
                onClick={() => setZoomIdx((i) => Math.min(ZOOM_STEPS.length - 1, i + 1))}
              />
            </div>
          ) : null}

          {failed ? (
            <StatusMessage kind="error">{t('loadError')}</StatusMessage>
          ) : !geometry ? (
            <div aria-busy="true" style={{ aspectRatio: aspect }}>
              <Skeleton variant="block" className="size-full rounded-md" />
              <span className="sr-only">{t('loading')}</span>
            </div>
          ) : (
            <div className={cn('rounded-md', zoom > 1 ? 'overflow-auto' : 'overflow-hidden')} data-zone-map-scroll="">
              <div className="relative" style={{ width: `${zoom * 100}%`, aspectRatio: aspect }}>
                <svg
                  viewBox={`0 0 ${geometry.meta.width} ${geometry.meta.height}`}
                  role="group"
                  aria-label={summary ? `${t('mapGroup')}. ${summary}` : t('mapGroup')}
                  aria-describedby={`${uid}-hint`}
                  data-zone-map-svg=""
                  className="block size-full"
                >
                  <defs>
                    <pattern id={hatchId} width="10" height="10" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                      <rect width="10" height="10" className="t2f-zone-hatch-bg" />
                      <line x1="0" y1="0" x2="0" y2="10" className="t2f-zone-hatch-line" />
                    </pattern>
                  </defs>
                  <g>
                    {geometry.zones.map((g) => {
                      const zone = zoneById.get(g.zoneId);
                      if (!zone) return null;
                      const state = stateOf(g.zoneId);
                      return (
                        <ZonePath
                          key={g.zoneId}
                          g={g}
                          zone={zone}
                          state={state}
                          hatchId={hatchId}
                          tabbable={tabStop === g.zoneId}
                          selected={selectedZoneId === g.zoneId}
                          pathRefs={pathRefs}
                          onKeyDown={onZoneKeyDown}
                          onFocus={onZoneFocus}
                          onBlur={() => {
                            setFocusedId(null);
                            setRingId(null);
                          }}
                          onSelect={() => setSelection({ kind: 'zone', id: g.zoneId })}
                          onHover={setHoverId}
                        />
                      );
                    })}
                  </g>
                  {geometry.zones.map((g) =>
                    ringId === g.zoneId ? (
                      <g key={`ring-${g.zoneId}`}>
                        <path d={g.d} data-ring="focus-outer" className="t2f-zone-ring" />
                        <path d={g.d} data-ring="focus" className="t2f-zone-ring" />
                      </g>
                    ) : null,
                  )}
                  {geometry.zones.map((g) =>
                    selectedZoneId === g.zoneId ? <path key={`sel-${g.zoneId}`} d={g.d} data-ring="selected" className="t2f-zone-ring" /> : null,
                  )}
                </svg>

                <div className="pointer-events-none absolute inset-0" data-zone-map-overlay="">
                  {geometry.markers.map((m) => {
                    const left = (m.x / geometry.meta.width) * 100;
                    const top = (m.y / geometry.meta.height) * 100;
                    return (
                      <span
                        key={m.zoneId}
                        aria-hidden="true"
                        data-zone-marker={m.zoneId}
                        className={cn(
                          'absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2',
                          MARKER_CLASS[stateOf(m.zoneId)],
                        )}
                        style={{ left: `${left}%`, top: `${top}%` }}
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
                        style={{ left: `${(g.label[0] / geometry.meta.width) * 100}%`, top: `${(g.label[1] / geometry.meta.height) * 100}%` }}
                      >
                        {st === 'live' ? (
                          <span className="block size-2.5 rounded-full bg-background" />
                        ) : (
                          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
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
                            <span className="relative size-2.5 rounded-full bg-zone-live ring-2 ring-text" data-city-dot="live" />
                          </>
                        ) : (
                          <span className="size-2 rounded-full bg-text-secondary ring-2 ring-background" data-city-dot="quiet" />
                        )}
                      </span>
                    );
                    const cls =
                      't2f-focus pointer-events-auto absolute flex size-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full';
                    const style = { left: `${pos.left}%`, top: `${pos.top}%` };
                    if (!isPhone && country) {
                      return (
                        <NextLink
                          key={city.id}
                          href={country.href}
                          aria-label={label}
                          tabIndex={-1}
                          data-city={city.id}
                          className={cls}
                          style={style}
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
                        aria-expanded={selection?.kind === 'city' && selection.id === city.id}
                        aria-controls={cardId}
                        tabIndex={-1}
                        data-city={city.id}
                        // Цілі сусідніх міст (44 px) перекриваються: вибране місто (його картка вже відкрита) — під іншими.
                        className={cn(cls, selection?.kind === 'city' && selection.id === city.id ? 'z-0' : 'z-10')}
                        style={style}
                        onClick={() => setSelection({ kind: 'city', id: city.id })}
                      >
                        {dot}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
          <p id={`${uid}-hint`} className="text-caption text-text-muted">
            {isPhone ? t('hintPhone') : t('hintDesktop')}
          </p>
        </div>
      ) : (
        <ZoneList
          zones={ordered}
          stateOf={stateOf}
          selectedId={selectedZoneId}
          onSelect={(id) => setSelection({ kind: 'zone', id })}
        />
      )}

      {layer === 'viewers' && viewers && viewers.length > 0 ? (
        <details className="rounded-lg border border-border bg-surface p-3" open data-viewers="">
          <summary className="t2f-focus min-h-touch-min cursor-pointer rounded-sm py-2 text-body-strong text-text">
            {tNav('viewersList', { count: viewers.length })}
          </summary>
          <ul className="flex flex-wrap gap-2">
            {viewers.map((v) => (
              <li key={v.iso} className="inline-flex items-center gap-2 text-body text-text-secondary">
                <Flag code={v.flagCode} size="xs" decorative />
                {v.name}
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      <div id={cardId} data-zone-map-card-slot="">
        {selectedCity && pinnedZone && isPhone ? (
          <MapTapCard
            ref={cardRef}
            city={selectedCity}
            country={countryByIso.get(selectedCity.countryIso) ?? pinnedZone.countries[0]!}
            zone={pinnedZone}
            state={stateOf(pinnedZone.id)}
            typeLabel={tType(TYPE_KEY[selectedCity.celebrationType])}
            onClose={closeSelection}
          />
        ) : pinnedZone ? (
          <ZoneCard ref={cardRef} zone={pinnedZone} state={stateOf(pinnedZone.id)} onClose={closeSelection} />
        ) : previewZone ? (
          <ZoneCard zone={previewZone} state={stateOf(previewZone.id)} pinned={false} />
        ) : null}
      </div>

      <MapLegend layout={layout} className="mt-1" />
    </section>
  );
}

interface ZonePathProps {
  g: ZoneMapGeometry['zones'][number];
  zone: MapZone;
  state: ZoneState;
  hatchId: string;
  tabbable: boolean;
  selected: boolean;
  pathRefs: RefObject<Map<string, SVGPathElement>>;
  onKeyDown: (e: KeyboardEvent<SVGPathElement>, id: string) => void;
  onFocus: (e: FocusEvent<SVGPathElement>, id: string) => void;
  onBlur: () => void;
  onSelect: () => void;
  onHover: (id: string | null) => void;
}

/** Один пояс: `path[data-offset]` з класом стану; доступна назва — країни, час і стан (без UTC). */
function ZonePath({ g, zone, state, hatchId, tabbable, selected, pathRefs, onKeyDown, onFocus, onBlur, onSelect, onHover }: ZonePathProps) {
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
  return (
    <path
      ref={(el) => {
        if (el) pathRefs.current.set(g.zoneId, el);
        else pathRefs.current.delete(g.zoneId);
      }}
      d={g.d}
      role="button"
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-pressed={selected}
      data-offset={g.offset}
      data-zone={g.zoneId}
      data-state={state}
      className={cn('t2f-zone', FILL_CLASS[state])}
      style={state === 'past' ? { fill: `url(#${hatchId})` } : undefined}
      onClick={onSelect}
      onKeyDown={(e) => onKeyDown(e, g.zoneId)}
      onFocus={(e) => onFocus(e, g.zoneId)}
      onBlur={onBlur}
      onPointerEnter={(e) => {
        if (e.pointerType === 'mouse') onHover(g.zoneId);
      }}
      onPointerLeave={() => onHover(null)}
    />
  );
}

interface ZoneListProps {
  zones: readonly MapZone[];
  stateOf: (id: string) => ZoneState;
  selectedId: string | undefined;
  onSelect: (id: string) => void;
}

/** «Список» — текстова альтернатива мапі: кожен пояс — кнопка з країнами, часом і станом. */
function ZoneList({ zones, stateOf, selectedId, onSelect }: ZoneListProps) {
  const tNav = useTranslations('nav');
  // Від найближчої півночі: спершу ті, що в ефірі й далі, потім минулі.
  const sorted = useMemo(() => [...zones].sort((a, b) => a.midnightMs - b.midnightMs), [zones]);
  return (
    <ul aria-label={tNav('map')} data-zone-list="" className="flex flex-col gap-1 rounded-lg bg-surface p-2">
      {sorted.map((z) => (
        <li key={z.id}>
          <button
            type="button"
            aria-pressed={selectedId === z.id}
            data-zone={z.id}
            data-state={stateOf(z.id)}
            onClick={() => onSelect(z.id)}
            className="t2f-focus t2f-transition flex min-h-touch-min w-full items-center gap-3 rounded-md border border-transparent px-3 py-2 text-start hover:bg-surface-raised aria-pressed:border-text aria-pressed:bg-surface-raised"
          >
            <span className="w-14 shrink-0 text-body-strong tabular-nums text-text">{formatClock(z.midnightMs)}</span>
            <span className="min-w-0 flex-1 truncate text-body text-text">
              {z.countries
                .slice(0, 3)
                .map((c) => c.name)
                .join(', ')}
            </span>
            <ZoneStateLabel state={stateOf(z.id)} />
          </button>
        </li>
      ))}
    </ul>
  );
}
