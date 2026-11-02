'use client';

import NextLink from 'next/link';
import { useTranslations } from 'next-intl';
import {
  useEffect,
  useId,
  useLayoutEffect,
  type ReactNode,
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
import { SegmentedControl } from '@/components/primitives/SegmentedControl';
import { Skeleton } from '@/components/primitives/Skeleton';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { zoneState, type ZoneState } from '@/lib/engine/zoneState';
import { formatClock } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { MapLegend } from './MapLegend';
import {
  pointToPercent,
  type MapCity,
  type MapCountry,
  type MapZone,
  type ZoneMapGeometry,
} from './MapModel';
import { CountryTip, MapTip, ZoneTip, tipKey, type MapTipTarget } from './MapTooltip';
import { MapTapCard, ZoneCard, ZoneStateLabel, useMidnightPhrase } from './ZoneMapCards';
import { MAX_K, MIN_K, useMapZoom } from './useMapZoom';
import './ZoneMap.css';
import m from './zoneMap.module.css';

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
  /** Місто ефіру: біля його точки — підпис «Лондон · наживо — дивитися» (макет). */
  airCityId?: string;
  /** Геометрія (`data/zonemap.json`); без неї підвантажується окремим шматком, поки показано скелетон. */
  geometry?: ZoneMapGeometry;
  className?: string;
}

type Selection = { kind: 'zone'; id: string } | { kind: 'city'; id: string } | null;

const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;
const PHONE_QUERY = '(max-width: 767.98px)';

function subscribePhone(cb: () => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}
const getPhone = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(PHONE_QUERY).matches : false);

/**
 * Геометрія мапи (~75 КБ) вантажиться, коли мапа наближається до екрана (SC-001): на першому екрані її немає,
 * і на мобільному вона не має забирати канал у плеєра. Без IntersectionObserver — одразу.
 */
function useGeometry(initial: ZoneMapGeometry | undefined, root: RefObject<HTMLElement | null>) {
  const [loaded, setLoaded] = useState<ZoneMapGeometry | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (initial) return;
    let alive = true;
    const load = () =>
      import('@/data/zonemap.json')
        .then((m) => {
          if (alive) setLoaded(m.default as unknown as ZoneMapGeometry);
        })
        .catch(() => {
          if (alive) setFailed(true);
        });
    const el = root.current;
    if (!el || typeof IntersectionObserver === 'undefined') {
      void load();
      return () => {
        alive = false;
      };
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((en) => en.isIntersecting)) return;
        io.disconnect();
        void load();
      },
      { rootMargin: '600px 0px' },
    );
    io.observe(el);
    return () => {
      alive = false;
      io.disconnect();
    };
  }, [initial, root]);
  return { geometry: initial ?? loaded, failed };
}

/** Плашка за курсором: праворуч-знизу (16 / 18 px), біля правого чи нижнього краю мапи — дзеркально. */
function placeTipAt(el: HTMLElement | null, box: HTMLElement | null, p: { x: number; y: number } | null) {
  if (!el || !box || !p) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  let x = p.x + 16;
  if (x + w > box.clientWidth - 8) x = Math.max(8, p.x - 16 - w);
  let y = p.y + 18;
  if (y + h > box.clientHeight - 8) y = Math.max(8, p.y - 10 - h);
  el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
}

const FILL_CLASS: Record<ZoneState, string> = { past: 'is-past', live: 'is-live', next: 'is-next', future: 'is-ahead' };
const MARKER_CLASS: Record<ZoneState, string> = {
  past: 'bg-border border-border-strong',
  live: 'bg-zone-live border-background',
  next: 'bg-zone-next border-background',
  future: 'bg-zone-future border-background',
};

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
  viewers,
  layout: layoutProp,
  defaultView = 'map',
  defaultLayer = 'zones',
  defaultSelectedZoneId,
  airCityId,
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
  const rootRef = useRef<HTMLElement>(null);
  const { geometry, failed } = useGeometry(geometryProp, rootRef);

  const [view, setView] = useState<'map' | 'list'>(defaultView);
  const [layer, setLayer] = useState<'zones' | 'viewers'>(defaultLayer);
  const [selection, setSelection] = useState<Selection>(
    defaultSelectedZoneId ? { kind: 'zone', id: defaultSelectedZoneId } : null,
  );
  // Пояс під курсором (суходіл, смуга в океані чи морська область): підсвічується весь пояс.
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [, setFocusedId] = useState<string | null>(null);
  const [ringId, setRingId] = useState<string | null>(null);
  const [tabStopId, setTabStopId] = useState<string | null>(null);

  const pathRefs = useRef(new Map<string, SVGGElement>());
  // Країна під курсором (суходіл або її морська область): `zoneId:iso` — підсвічується сильніше за свій пояс.
  const [hotCountry, setHotCountry] = useState<string | null>(null);
  // Місто під курсором: його пояс і країна лишаються підсвіченими, плашки немає (поруч підпис міста).
  const [onCity, setOnCity] = useState(false);
  const viewerIso = useGuestStore((g) => g.flagCode);
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
  // Скільки поясів у країни (плашка: «UTC+3 · ще 10 поясів»).
  const zoneCountByIso = useMemo(() => {
    const m = new Map<string, number>();
    for (const z of zones) for (const c of z.countries) m.set(c.iso, (m.get(c.iso) ?? 0) + 1);
    return m;
  }, [zones]);

  const liveZoneId = ordered.find((z) => stateOf(z.id) === 'live')?.id;
  const tabStop = tabStopId && zoneById.has(tabStopId) ? tabStopId : (liveZoneId ?? ordered[0]?.id ?? null);

  const selectedZoneId = selection?.kind === 'zone' ? selection.id : selection?.kind === 'city' ? cities.find((c) => c.id === selection.id)?.zoneId : undefined;
  const selectedCity = selection?.kind === 'city' ? cities.find((c) => c.id === selection.id) : undefined;

  function focusZone(id: string) {
    setTabStopId(id);
    pathRefs.current.get(id)?.focus();
  }

  function onZoneKeyDown(e: KeyboardEvent<SVGGElement>, id: string) {
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

  function onZoneFocus(e: FocusEvent<SVGGElement>, id: string) {
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

  const aspect = geometry ? geometry.meta.width / geometry.meta.height : 1781 / 911;
  const boxRef = useRef<HTMLDivElement>(null);
  const { view: zoom, box, zoomIn, zoomOut, reset } = useMapZoom(boxRef, Boolean(geometry));
  const zoomed = zoom.k > MIN_K + 0.01;
  // Видима частина мапи (координати мапи): масштаб — через viewBox, тож усе лишається векторним і чітким.
  const mw = geometry?.meta.width ?? 1781;
  const mh = geometry?.meta.height ?? 911;
  const pxToMap = box.w > 0 ? mw / box.w : 0;
  const vb = { x: -zoom.x * pxToMap / zoom.k, y: -zoom.y * pxToMap / zoom.k, w: mw / zoom.k, h: mh / zoom.k };
  /** Точка мапи (відсотки повної мапи) → відсотки рамки з урахуванням масштабу й зсуву. */
  const place = (leftPct: number, topPct: number) => ({
    left: `${leftPct * zoom.k + (box.w > 0 ? (zoom.x / box.w) * 100 : 0)}%`,
    top: `${topPct * zoom.k + (box.h > 0 ? (zoom.y / box.h) * 100 : 0)}%`,
  });
  // Назви міст біля точок — від наближення ×2.
  const showNames = zoom.k >= 2;

  const pinnedZone = selectedZoneId ? zoneById.get(selectedZoneId) : undefined;

  // Плашка при наведенні (рішення власника 2026-11-02, дошка `Desk-Map-Tips`): лише десктоп; одна одночасно — країна
  // важливіша за пояс; з’являється через 150 мс, зникає через 100 мс; між сусідніми цілями — одразу.
  const hotSep = hotCountry ? hotCountry.lastIndexOf(':') : -1;
  const pointerTarget: MapTipTarget | null =
    isPhone || onCity
      ? null
      : hotCountry && hotSep > 0
        ? { kind: 'country', zoneId: hotCountry.slice(0, hotSep), iso: hotCountry.slice(hotSep + 1) }
        : hoverId
          ? { kind: 'zone', zoneId: hoverId }
          : null;
  // З клавіатури: фокус на поясі (видимий) — плашка біля мітки поясу.
  const keyTarget: MapTipTarget | null = !isPhone && !pointerTarget && ringId ? { kind: 'zone', zoneId: ringId } : null;
  const rawTarget = pointerTarget ?? keyTarget;
  const rawKey = tipKey(rawTarget);
  const [tip, setTip] = useState<{ target: MapTipTarget; byKey: boolean } | null>(null);
  const tipShown = tipKey(tip?.target ?? null);
  useEffect(() => {
    if (rawKey === tipShown) return;
    const next = rawTarget ? { target: rawTarget, byKey: !pointerTarget } : null;
    const delay = !rawTarget ? 100 : tipShown || next?.byKey ? 0 : 150;
    const id = window.setTimeout(() => setTip(next), delay);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- ціль описує її ключ
  }, [rawKey, tipShown]);
  const tipRef = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  // Чи плашка з клавіатури (тоді її позиція — біля мітки поясу, не за курсором); оновлюється після рендеру.
  const tipByKeyRef = useRef(false);
  const tipZone = tip ? zoneById.get(tip.target.zoneId) : undefined;
  const tipCountry =
    tip?.target.kind === 'country' && tipZone
      ? (tipZone.countries.find((c) => c.iso === (tip.target as { iso: string }).iso) ?? countryByIso.get(tip.target.iso))
      : undefined;
  const tipLabel = tip?.byKey && geometry ? geometry.zones.find((g) => g.zoneId === tip.target.zoneId)?.label : undefined;
  const tipStyle = (() => {
    if (!tipLabel || !geometry) return undefined;
    const lp = (tipLabel[0] / geometry.meta.width) * 100;
    const pos = place(lp, (tipLabel[1] / geometry.meta.height) * 100);
    // Права третина мапи — плашка ліворуч від мітки.
    return { left: pos.left, top: pos.top, transform: lp > 66 ? 'translate(calc(-100% - 12px), 12px)' : 'translate(12px, 12px)' };
  })();
  useLayoutEffect(() => {
    tipByKeyRef.current = Boolean(tip?.byKey);
    if (!tip?.byKey) placeTipAt(tipRef.current, boxRef.current, pointer.current);
  });
  useEffect(() => {
    const bx = boxRef.current;
    if (!bx) return;
    const move = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const r = bx.getBoundingClientRect();
      pointer.current = { x: e.clientX - r.left, y: e.clientY - r.top };
      const el = tipRef.current;
      if (el) el.style.visibility = e.buttons ? 'hidden' : '';
      if (!tipByKeyRef.current) placeTipAt(el, bx, pointer.current);
    };
    bx.addEventListener('pointermove', move);
    return () => bx.removeEventListener('pointermove', move);
  }, [geometry]);

  const liveZone = ordered.find((z) => stateOf(z.id) === 'live');
  const summary = liveZone ? `${liveZone.countries.slice(0, 3).map((c) => c.name).join(', ')} · ${t('state.live')}` : '';
  // Підпис біля точки трансляції в ефірі (макет: «Лондон · наживо — дивитися»).
  const labelCity = cities.find((c) => c.stream === 'live' && stateOf(c.zoneId) === 'live' && (!airCityId || c.id === airCityId));

  const card =
    selectedCity && pinnedZone && isPhone ? (
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
      // Наведення нічого не показує (рішення власника); картка — лише після вибору поясу (клік, Enter).
      <ZoneCard ref={cardRef} zone={pinnedZone} state={stateOf(pinnedZone.id)} onClose={closeSelection} />
    ) : null;
  const cardSlot = (
    <div id={cardId} data-zone-map-card-slot="" className={cn(!isPhone && 'mt-auto')}>
      {card}
    </div>
  );
  const hint = (
    <p id={`${uid}-hint`} className={cn(m.hint, (isPhone || card) && 'sr-only')}>
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
                  data-hover={hoverId === g.zoneId ? 'true' : undefined}
                  data-selected={selectedZoneId === g.zoneId || ringId === g.zoneId ? 'true' : undefined}
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
                      data-hot={hotCountry === `${g.zoneId}:${s.iso}` ? 'true' : undefined}
                      className="t2f-zone-sea"
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
                  hovered={hoverId === g.zoneId}
                  hotCountry={hotCountry}
                  onHotCountry={setHotCountry}
                  areas={geometry.areas?.filter((a) => a.zoneId === g.zoneId)}
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
          {geometry.lakes ? <path d={geometry.lakes} className="t2f-zm-lakes" /> : null}
          {geometry.sea ? <path d={geometry.sea} className="t2f-zm-sea" /> : null}
          {geometry.borders ? <path d={geometry.borders} className="t2f-zm-borders" /> : null}
          {geometry.zoneLines ? <path d={geometry.zoneLines} className="t2f-zm-zlines" /> : null}
          {geometry.dayline ? <path d={geometry.dayline} className="t2f-zm-dayline" /> : null}

        </svg>

        <div className="pointer-events-none absolute inset-0" data-zone-map-overlay="">
          {geometry.markers.map((mk) => {
            const pos = place((mk.x / geometry.meta.width) * 100, (mk.y / geometry.meta.height) * 100);
            return (
              <span
                key={mk.zoneId}
                aria-hidden="true"
                data-zone-marker={mk.zoneId}
                className={cn('absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full border', MARKER_CLASS[stateOf(mk.zoneId)])}
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
                style={place((g.label[0] / geometry.meta.width) * 100, (g.label[1] / geometry.meta.height) * 100)}
              >
                {st === 'live' ? (
                  <span className="block size-1.5 rounded-full bg-background" />
                ) : (
                  <svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
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
                    <span className="t2f-zm-dot-live relative size-2.5 rounded-full bg-zone-live" data-city-dot="live" />
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
                setOnCity(true);
                setHoverId(city.zoneId);
                setHotCountry(`${city.zoneId}:${city.countryIso}`);
              },
              onPointerLeave: (e: { pointerType: string }) => {
                if (e.pointerType !== 'mouse') return;
                setOnCity(false);
                setHoverId(null);
                setHotCountry(null);
              },
            };
            if (!isPhone && country) {
              return (
                <NextLink key={city.id} href={country.href} aria-label={label} tabIndex={-1} data-city={city.id} className={cls} style={style} {...cityHover}>
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
                {...cityHover}
                onClick={() => setSelection({ kind: 'city', id: city.id })}
              >
                {dot}
              </button>
            );
          })}
          {labelCity ? (
            <span
              aria-hidden="true"
              data-zone-map-live-label=""
              className={cn(m.liveLabel, isPhone ? m.liveLabelPhone : m.liveLabelDesk)}
              style={(() => {
                const p = place(pointToPercent(labelCity, geometry.meta).left, pointToPercent(labelCity, geometry.meta).top);
                return isPhone ? p : { right: `calc(100% - ${p.left})`, top: p.top };
              })()}
            >
              {t('liveLabel', { city: labelCity.name })}
              <span className={m.liveLabelWatch}>{isPhone ? t('liveLabelWatchPhone') : t('liveLabelWatch')}</span>
            </span>
          ) : null}
          {showNames
            ? cities
                .filter((c) => c.id !== labelCity?.id)
                .map((c) => {
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
      </div>
      {tipZone ? (
        <MapTip ref={tipRef} kind={tip!.target.kind} style={tipStyle}>
          {tip!.target.kind === 'country' && tipCountry ? (
            <CountryTip
              zone={tipZone}
              country={tipCountry}
              state={stateOf(tipZone.id)}
              now={now}
              zoneCount={zoneCountByIso.get(tipCountry.iso) ?? 1}
            />
          ) : (
            <ZoneTip zone={tipZone} state={stateOf(tipZone.id)} now={now} viewerIso={viewerIso} />
          )}
        </MapTip>
      ) : null}
      <div className={cn(m.zoom, isPhone ? m.zoomPhone : m.zoomDesk)} role="group" aria-label={t('zoomGroup')} data-zone-map-zoom="">
        {isPhone ? (
          <>
            <ZoomButton label={t('zoomIn')} disabled={zoom.k >= MAX_K - 0.01} onClick={zoomIn}>
              +
            </ZoomButton>
            <ZoomButton label={t('zoomOut')} disabled={!zoomed} onClick={zoomOut}>
              −
            </ZoomButton>
            <ZoomButton label={t('zoomReset')} disabled={!zoomed} onClick={reset}>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                <path d="M4 12a8 8 0 1 0 2.3-5.6" />
                <path d="M4 4v4h4" />
              </svg>
            </ZoomButton>
          </>
        ) : (
          <>
            <ZoomButton label={t('zoomOut')} disabled={!zoomed} onClick={zoomOut}>
              −
            </ZoomButton>
            <span className={m.zoomValue}>{Math.round(zoom.k * 100)}%</span>
            <ZoomButton label={t('zoomIn')} disabled={zoom.k >= MAX_K - 0.01} onClick={zoomIn}>
              +
            </ZoomButton>
            <span aria-hidden="true" className={m.zoomSep} />
            <button type="button" disabled={!zoomed} onClick={reset} className={cn('t2f-focus', m.zoomReset)}>
              {t('zoomReset')}
            </button>
          </>
        )}
      </div>
    </div>
  );

  return (
    // Esc із будь-якого місця мапи й картки закриває картку (клавіатурний прийом, не окрема дія).
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
    <section
      ref={rootRef}
      aria-labelledby={headId}
      data-zone-map=""
      data-layout={layout}
      onKeyDown={onRootKeyDown}
      className={cn(m.section, className)}
    >
      <div className={m.head}>
        <h2 id={headId} className={cn('t2f-h2', m.title)}>
          {tNav('map')}
        </h2>
        <div className={m.controls}>
          <SegmentedControl
            semantics="pressed"
            label={t('layerLabel')}
            value={viewers && viewers.length > 0 ? layer : 'zones'}
            onValueChange={(v) => setLayer(v as 'zones' | 'viewers')}
            options={[
              { value: 'zones', label: tNav('zones') },
              { value: 'viewers', label: tNav('viewersFrom'), disabled: !viewers || viewers.length === 0 },
            ]}
          />
          <SegmentedControl
            semantics="pressed"
            label={t('viewLabel')}
            value={view}
            onValueChange={(v) => setView(v as 'map' | 'list')}
            // «Список» поки сховано (рішення власника): у макетах головної його вигляду немає; повернеться у вигляді
            // списку з макета Desk-Countries / Phone-Countries. Компонент ZoneList лишається.
            options={[{ value: 'map', label: tNav('mapShort') }]}
          />
        </div>
      </div>

      {view === 'map' ? (
        isPhone ? (
          <>
            <div className={m.canvas} data-zone-map-canvas="">
              {canvas}
              {hint}
            </div>
            {cardSlot}
          </>
        ) : (
          <div className={m.canvas} data-zone-map-canvas="">
            <div className={m.mapCol}>{canvas}</div>
            <div className={m.side}>
              <MapLegend layout={layout} variant="column" />
              {cardSlot}
              {hint}
            </div>
          </div>
        )
      ) : (
        <ZoneList zones={ordered} stateOf={stateOf} selectedId={selectedZoneId} onSelect={(id) => setSelection({ kind: 'zone', id })} />
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

      {view === 'list' ? cardSlot : null}
      {isPhone || view === 'list' ? <MapLegend layout={layout} className={m.legendBelow} /> : null}
    </section>
  );
}

interface ZoneGroupProps {
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
  onHotCountry: (key: string | null) => void;
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
function ZoneGroup({
  g,
  zone,
  state,
  tabbable,
  selected,
  focused,
  hovered,
  hotCountry,
  onHotCountry,
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
  const hot = (iso: string) => hotCountry === `${g.zoneId}:${iso}`;
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
          onPointerEnter={enter(a.iso)}
          onPointerLeave={leave}
        />
      ))}
    </g>
  );
}

/** Кнопка масштабу мапи (квадрат 32 px; `aria-label` — дія). */
function ZoomButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" aria-label={label} title={label} disabled={disabled} onClick={onClick} className={cn('t2f-focus', m.zoomBtn)}>
      {children}
    </button>
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
