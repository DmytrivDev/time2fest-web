'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
  type Ref,
  type RefObject,
} from 'react';
import { cn } from '@/components/primitives/cn';
import {
  CarouselArrow,
  glideTo,
  slideStops,
  useDragScroll,
} from '@/components/primitives/Carousel';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Reveal } from '@/components/primitives/Reveal';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock, formatCountdown, formatDurationShort } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { MapStreamCard, PlayMark, ScheduleButton, type MapStreamMode } from './MapStreamCard';
import { StateSwatch } from './MapSide';
import { viewerOffsetAt } from './MapTooltip';
import { utcLabel, type MapCountry, type MapStream, type MapZone } from './MapModel';
import { useMidnightPhrase } from './ZoneMapCards';
import { REGION_ORDER, regionOf, type RegionKey } from './regions';
import m from './zonePanel.module.css';

const TOP = 5;
const NOT_TOP = new Set(['RU', 'BY']);
/** На телефоні одразу видно дві групи регіонів, решта — кнопкою «Ще …». */
const PHONE_GROUPS = 2;

export interface ZonePanelProps {
  zone: MapZone;
  state: ZoneState;
  prev?: MapZone;
  next?: MapZone;
  phone: boolean;
  onSelect: (id: string) => void;
  onClose: () => void;
  /**
   * Клік по країні (картка чи плитка) — вікно країни на тому самому місці (рішення власника 2026-11-04). Посилання на
   * сторінку країни лишаються: клік із Ctrl / Cmd / Shift чи середньою кнопкою відкриває сторінку.
   */
  onSelectCountry?: (iso: string) => void;
  /** Усередині рядка вкладки «Список»: шапки з назвою, стрілками й «×» немає — лише стан і «ваш пояс». */
  embedded?: boolean;
  ref?: Ref<HTMLElement>;
}

/**
 * Вікно поясу під мапою (рішення власника 2026-11-03, дошка `Desk-Map-ZonePanel`): шапка зі стрілками до сусідніх
 * поясів, таймер до півночі з секундами (виняток із «одного відліку»: головний — угорі сторінки), коротко про пояс,
 * «Де дивитися» — стрічка трансляцій, країни двома полицями: найпопулярніші картками, решта — за регіонами.
 */
export function ZonePanel({
  zone,
  state,
  prev,
  next,
  phone,
  onSelect,
  onClose,
  onSelectCountry,
  embedded = false,
  ref,
}: ZonePanelProps) {
  const t = useTranslations('liveMap.panel');
  const offset = utcLabel(zone.offsetMinutes);
  const own = viewerOffsetAt(zone.midnightMs) === zone.offsetMinutes;
  const streams = zone.streams ?? [];
  const head = (
    <span className={m.title}>
      <StateSwatch state={state} className={m.swatch} />
      <h3 className={m.name}>{offset}</h3>
      <StateBadge state={state} />
      {own ? <span className={m.own}>{t('yourZone')}</span> : null}
    </span>
  );
  // Новий рік іде мапою справа наліво: наступний пояс — ліворуч (стрілка вліво), попередній — праворуч (правка
  // власника 2026-11-03). На телефоні — короткі слова, щоб обидві кнопки вмістилися в рядок.
  const nav = (
    <span className={m.nav}>
      {next ? (
        <button
          type="button"
          className={cn('t2f-focus', m.navBtn)}
          aria-label={t('nextZone', { offset: utcLabel(next.offsetMinutes) })}
          onClick={() => onSelect(next.id)}
        >
          <Icon name="chevron-left" size={16} />
          <span className={m.navWord}>{phone ? t('nextShort') : t('nextWord')}</span>
          {utcLabel(next.offsetMinutes)}
        </button>
      ) : null}
      {prev ? (
        <button
          type="button"
          className={cn('t2f-focus', m.navBtn)}
          aria-label={t('prevZone', { offset: utcLabel(prev.offsetMinutes) })}
          onClick={() => onSelect(prev.id)}
        >
          <span className={m.navWord}>{phone ? t('prevShort') : t('prevWord')}</span>
          {utcLabel(prev.offsetMinutes)}
          <Icon name="chevron-right" size={16} />
        </button>
      ) : null}
    </span>
  );
  const close = (
    <IconButton icon="close" aria-label={t('close')} onClick={onClose} className={m.close} />
  );
  return (
    <section
      ref={ref}
      className={cn(m.panel, phone && m.phone, embedded && m.embedded)}
      data-zone-panel={zone.id}
      data-state={state}
      aria-label={t('aria', { offset })}
    >
      {embedded ? (
        <div className={m.embeddedHead}>
          <StateBadge state={state} />
          {own ? <span className={m.own}>{t('yourZone')}</span> : null}
        </div>
      ) : phone ? (
        <>
          <div className={m.headRow}>
            {head}
            {close}
          </div>
          <div className={m.navRow}>{nav}</div>
        </>
      ) : (
        <div className={m.headRow}>
          {head}
          {nav}
          {close}
        </div>
      )}
      <div className={m.body}>
        <div className={m.timeCol}>
          <ZoneTime zone={zone} state={state} />
          <dl className={m.stats}>
            <Stat
              n={zone.countries.length}
              label={t('countriesWord', { count: zone.countries.length })}
            />
            <Stat
              n={zone.streamCount ?? streams.length}
              label={t('streamsWord', { count: zone.streamCount ?? streams.length })}
            />
            <Stat n={zone.cityCount ?? 0} label={t('citiesWord', { count: zone.cityCount ?? 0 })} />
          </dl>
        </div>
        <div className={m.watchCol}>
          {streams.length === 0 ? (
            <>
              <h4 className={m.h4}>{state === 'past' ? t('replayTitle') : t('watchTitle')}</h4>
              <p className={m.empty}>{state === 'past' ? t('noReplays') : t('noStreams')}</p>
            </>
          ) : (
            // Новий пояс — нова стрічка: стрілки рахуються від її карток, прокрутка — з початку.
            <Slider
              key={zone.id}
              phone={phone}
              label={state === 'past' ? t('replayTitle') : t('watchTitle')}
              title={state === 'past' ? t('replayTitle') : t('watchTitle')}
            >
              {streams.map((s) => (
                <ZoneStreamCard
                  key={s.cityId}
                  stream={s}
                  mode={state === 'past' ? 'replay' : state === 'live' ? 'live' : 'upcoming'}
                  midnightMs={zone.midnightMs}
                />
              ))}
            </Slider>
          )}
        </div>
      </div>
      <Countries zone={zone} state={state} phone={phone} onSelectCountry={onSelectCountry} />
    </section>
  );
}

export function StateBadge({ state }: { state: ZoneState }) {
  const t = useTranslations('liveMap.panel.state');
  return (
    <span className={cn(m.badge, m[`badge_${state}`])} data-badge={state}>
      {state === 'live' ? <span aria-hidden="true" className={m.badgeDot} /> : null}
      {state === 'next' ? <Icon name="clock" size={12} /> : null}
      {t(state)}
    </span>
  );
}

/** Таймер до півночі з секундами; щойно після півночі — «Північ щойно настала»; потім — скільки тому. */
function ZoneTime({ zone, state }: { zone: MapZone; state: ZoneState }) {
  const t = useTranslations('liveMap.panel');
  const locale = useLocale();
  const now = useNow();
  const when = useMidnightPhrase(zone.midnightMs);
  const left = zone.midnightMs - now;
  if (state === 'past' || now >= zone.midnightMs + HANDOVER_AFTER) {
    return (
      <div data-zone-time="past">
        <div className={m.smallCap}>{t('pastLabel')}</div>
        <div className={m.ago}>
          {t('pastAgo', { dur: formatDurationShort(now - zone.midnightMs, locale) })}
        </div>
        <div className={m.when}>
          {t('pastAt', { time: formatClock(zone.midnightMs, { locale }) })}
        </div>
      </div>
    );
  }
  if (left <= 0) {
    return (
      <div data-zone-time="now">
        <div className={m.smallCap}>{t('nowLabel')}</div>
        <div className={m.ago}>{t('nowText')}</div>
        <div className={m.when}>{when}</div>
      </div>
    );
  }
  return (
    <div data-zone-time="until">
      <div className={m.smallCap}>{t('untilLabel')}</div>
      <div className={m.timer} role="timer" aria-live="off">
        {formatCountdown(left)}
      </div>
      <div className={m.when}>{when}</div>
    </div>
  );
}

function Stat({ n, label }: { n: number; label: string }) {
  return (
    <div className={m.stat}>
      <dt className="sr-only">{label}</dt>
      <dd className={m.statN}>{n}</dd>
      <dd className={m.statL} aria-hidden="true">
        {label}
      </dd>
    </div>
  );
}

const CARD = ':scope > li';
/** Найвужча картка, на якій підписи («Головне святкування · Повтор») стоять в один рядок. */
const CARD_MIN = 248;
const CARD_GAP = 12;
/** Яка частка наступної картки визирає з-під правого краю, коли всі не вміщаються. */
const PEEK = 0.45;

/**
 * Стрічка «Де дивитися» / «Переглянути в повторі» з заголовком (правка власника 2026-11-04):
 * - стрілки — у рядку заголовка, кожна гортає на одну картку; мишею — натиснути й тягти, на дотик — свайп;
 * - праворуч стрічка доходить до краю вікна (картка, що не вміщається, обрізана рамкою вікна), ліворуч — по краю
 *   колонки; після гортання ліворуч завжди видно картку повністю;
 * - не вміщаються всі — ширину картки підібрано так, щоб видно було кілька повних і чималий шматок наступної (не вужче
 *   248 px); наприкінці праворуч лишається простір: хвіст стрічки підібрано так, що остання позиція — початок картки.
 */
export function Slider({
  phone,
  label,
  title,
  children,
}: {
  phone: boolean;
  label: string;
  title: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations('liveMap.panel');
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  useDragScroll(ref as RefObject<HTMLElement | null>, CARD);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () =>
      setEdge({
        start: el.scrollLeft <= 2,
        end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2,
      });
    const fit = () => {
      const cards = [...el.querySelectorAll<HTMLElement>(CARD)];
      if (!cards.length) return;
      if (!phone) {
        const col = el.parentElement?.clientWidth ?? el.clientWidth;
        const fits = cards.length * CARD_MIN + (cards.length - 1) * CARD_GAP <= col;
        let k = Math.max(1, Math.floor((el.clientWidth + CARD_GAP) / (CARD_MIN + CARD_GAP)));
        while (k > 1 && (el.clientWidth - k * CARD_GAP) / (k + PEEK) < CARD_MIN) k--;
        const w = Math.floor((el.clientWidth - k * CARD_GAP) / (k + PEEK));
        if (fits) el.style.removeProperty('--card-w');
        else el.style.setProperty('--card-w', `${w}px`);
      }
      const origin = el.getBoundingClientRect().left - el.scrollLeft;
      const lefts = cards.map((c) => c.getBoundingClientRect().left - origin);
      const padL = lefts[0]!;
      const last = cards.at(-1)!;
      const right = last.getBoundingClientRect().right - origin;
      const view = el.clientWidth;
      // Скільки останніх карток уміщаються повністю, коли перша з них — біля лівого краю.
      let k = 1;
      while (k < cards.length && right - lefts[cards.length - k - 1]! <= view - padL) k++;
      const first = lefts[cards.length - k]! - padL;
      const tail = right <= view ? 0 : Math.max(0, Math.round(first + view - right));
      if (tail) el.style.paddingRight = `${tail}px`;
      else el.style.removeProperty('padding-right');
      upd();
    };
    fit();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(fit) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro?.disconnect();
    };
  }, [phone]);
  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const stops = slideStops(el, CARD);
    const cur = el.scrollLeft;
    const target =
      dir > 0
        ? (stops.find((x) => x > cur + 2) ?? stops.at(-1)!)
        : ([...stops].reverse().find((x) => x < cur - 2) ?? 0);
    glideTo(el, target);
  };
  const arrows = !phone && !(edge.start && edge.end);
  return (
    <div className={m.slider} data-slider-arrows={arrows ? 'true' : 'false'}>
      <div className={m.sliderHead}>
        <h4 className={m.h4}>{title}</h4>
        {arrows ? (
          <span className={m.arrows}>
            <CarouselArrow
              dir="prev"
              size="md"
              label={t('slidePrev')}
              disabled={edge.start}
              onClick={() => go(-1)}
            />
            <CarouselArrow
              dir="next"
              size="md"
              label={t('slideNext')}
              disabled={edge.end}
              onClick={() => go(1)}
            />
          </span>
        ) : null}
      </div>
      <ul ref={ref} className={cn(m.track, phone && m.trackPhone)} aria-label={label}>
        {children}
      </ul>
    </div>
  );
}

/** Трансляція поясу: місто, країна з прапором, час півночі (коли попереду); кнопка — сторінка країни. */
function ZoneStreamCard({ stream, mode, midnightMs }: { stream: MapStream; mode: MapStreamMode; midnightMs: number }) {
  const t = useTranslations('liveMap.panel');
  const locale = useLocale();
  return (
    <MapStreamCard
      cityId={stream.cityId}
      type={stream.type}
      mode={mode}
      href={stream.href}
      eventId={stream.eventId}
      city={stream.city}
      upcomingLabel={t('countryPage')}
    >
      <div className={m.cardCity}>{stream.city}</div>
      <div className={m.cardCountry}>
        <Flag code={stream.flagCode} diameter={18} decorative />
        {stream.country}
      </div>
      {mode === 'upcoming' ? (
        <div className={m.cardWhen}>
          <Icon name="clock" size={14} />
          {t('startsAt', { time: formatClock(midnightMs, { locale }) })}
        </div>
      ) : null}
    </MapStreamCard>
  );
}

/** Країни поясу: найпопулярніші — картками, усі інші — плитками за регіонами. Клік — сторінка країни. */
/** Звичайний клік лівою кнопкою без модифікаторів — у вікні; решта — нативно (нова вкладка, сторінка країни). */
function inPlace(e: MouseEvent<HTMLAnchorElement>, iso: string, onSelect?: (iso: string) => void) {
  if (!onSelect || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  e.preventDefault();
  onSelect(iso);
}

function Countries({
  zone,
  state,
  phone,
  onSelectCountry,
}: {
  zone: MapZone;
  state: ZoneState;
  phone: boolean;
  onSelectCountry?: (iso: string) => void;
}) {
  const t = useTranslations('liveMap.panel');
  const tR = useTranslations('liveMap.regions');
  const [more, setMore] = useState(false);
  // Росія й Білорусь — не серед найпопулярніших (рішення власника 2026-11-03); у регіонах — усі країни поясу.
  const top = zone.countries.filter((c) => !NOT_TOP.has(c.iso)).slice(0, TOP);
  const rest = zone.countries;
  const groups = new Map<RegionKey | 'other', MapCountry[]>();
  for (const c of rest) {
    const r = regionOf(c.iso, zone.offsetMinutes) ?? 'other';
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  const ordered = [...REGION_ORDER, 'other' as const]
    .filter((r) => groups.has(r))
    .map((r) => ({ key: r, list: groups.get(r)! }));
  const shown = phone ? ordered.slice(0, PHONE_GROUPS) : ordered;
  const hidden = phone ? ordered.slice(PHONE_GROUPS) : [];
  const hiddenCount = hidden.reduce((n, g) => n + g.list.length, 0);
  const streamIsos = new Set((zone.streams ?? []).map((s) => s.iso));
  // Графік — це країни: календарик на кожній країні поясу, що ще попереду, і там, де лише відлік (рішення 2026-11-04).
  const ahead = state === 'next' || state === 'future';
  const eventOf = (c: MapCountry) => c.streams?.[0]?.eventId ?? c.eventIds?.[0];
  const group = (g: { key: RegionKey | 'other'; list: MapCountry[] }) => (
    <div key={g.key} className={m.region} data-region={g.key}>
      <h5 className={m.smallCap}>
        {tR(g.key)} · {g.list.length}
      </h5>
      <ul className={cn(m.tiles, phone && m.tilesPhone)}>
        {g.list.map((c) => (
          <li key={c.iso} className={cn(m.tileItem, ahead && eventOf(c) && m.tileWithCal)}>
            <NextLink
              href={c.href}
              className={cn('t2f-focus', m.tile)}
              data-country-tile={c.iso}
              onClick={(e) => inPlace(e, c.iso, onSelectCountry)}
            >
              <Flag code={c.flagCode} diameter={22} decorative />
              <span className={m.tileName}>{c.name}</span>
              {streamIsos.has(c.iso) ? (
                <span className={m.tilePlay} role="img" aria-label={t('hasStream')}>
                  <Icon name="play" size={12} />
                </span>
              ) : null}
            </NextLink>
            {ahead && eventOf(c) ? (
              <span className={m.tileCal}>
                <ScheduleButton eventId={eventOf(c)} city={c.city ?? c.name} size="sm" />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className={m.countries}>
      <div className={m.countriesHead}>
        <h4 className={m.h4}>{t('countriesTitle')}</h4>
        <span className={m.countriesNote}>
          {t('countriesNote', { count: zone.countries.length })}
        </span>
      </div>
      <ul className={cn(m.shelf, phone && m.shelfPhone)}>
        {top.map((c) => (
          <li key={c.iso} className={m.shelfItem}>
            <NextLink
              href={c.href}
              className={cn('t2f-focus', m.topCard)}
              data-country-card={c.iso}
              onClick={(e) => inPlace(e, c.iso, onSelectCountry)}
            >
              <Flag code={c.flagCode} diameter={40} decorative />
              <span className={m.topName}>{c.name}</span>
              {c.city ? <span className={m.topCity}>{c.city}</span> : null}
              {streamIsos.has(c.iso) && state === 'live' ? (
                // Трансляція йде — біла залита кнопка (правка власника 2026-11-04); веде, як і вся картка, на сторінку країни.
                <span className={m.topBtn} data-country-stream="live">
                  <PlayMark tone="live" size={14} />
                  {t('streamLiveBtn')}
                </span>
              ) : streamIsos.has(c.iso) ? (
                <span className={m.topStream}>
                  <PlayMark tone="upcoming" size={12} />
                  {t('streamYes')}
                </span>
              ) : (
                <span className={m.topNoStream}>{t('streamNo')}</span>
              )}
            </NextLink>
            {ahead && eventOf(c) ? (
              <span className={m.topCal}>
                <ScheduleButton eventId={eventOf(c)} city={c.city ?? c.name} />
              </span>
            ) : null}
          </li>
        ))}
      </ul>
      {ordered.length ? (
        <div className={cn(m.smallCap, m.restTitle)}>{t('regionsTitle')}</div>
      ) : null}
      {shown.map(group)}
      {hidden.length ? (
        <>
          <Reveal open={more}>{hidden.map(group)}</Reveal>
          <button
            type="button"
            className={cn('t2f-focus', m.moreBtn)}
            aria-expanded={more}
            onClick={() => setMore((v) => !v)}
          >
            {more
              ? t('less')
              : hidden.length === 1
                ? t('moreRegion', { region: tR(hidden[0]!.key), count: hiddenCount })
                : t('moreCountries', { count: hiddenCount })}
            <Icon name={more ? 'chevron-up' : 'chevron-down'} size={16} />
          </button>
        </>
      ) : null}
    </div>
  );
}
