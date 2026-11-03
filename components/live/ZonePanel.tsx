'use client';

import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useEffect, useRef, useState, type ReactNode, type Ref } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { IconButton } from '@/components/primitives/IconButton';
import { Reveal } from '@/components/primitives/Reveal';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatClock, formatCountdown, formatDurationShort } from '@/lib/i18n/time';
import { useNow } from '@/lib/time/TimeProvider';
import { StateSwatch } from './MapSide';
import { viewerOffsetAt } from './MapTooltip';
import { utcLabel, type MapCountry, type MapStream, type MapZone } from './MapModel';
import { useMidnightPhrase } from './ZoneMapCards';
import { REGION_ORDER, regionOf, type RegionKey } from './regions';
import m from './zonePanel.module.css';

const TYPE_KEY = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;
const TOP = 5;
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
  ref?: Ref<HTMLElement>;
}

/**
 * Вікно поясу під мапою (рішення власника 2026-11-03, дошка `Desk-Map-ZonePanel`): шапка зі стрілками до сусідніх
 * поясів, таймер до півночі з секундами (виняток із «одного відліку»: головний — угорі сторінки), коротко про пояс,
 * «Де дивитися» — стрічка трансляцій, країни двома полицями: найпопулярніші картками, решта — за регіонами.
 */
export function ZonePanel({ zone, state, prev, next, phone, onSelect, onClose, ref }: ZonePanelProps) {
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
  const nav = (
    <span className={m.nav}>
      {prev ? (
        <button type="button" className={cn('t2f-focus', m.navBtn)} aria-label={t('prevZone', { offset: utcLabel(prev.offsetMinutes) })} onClick={() => onSelect(prev.id)}>
          <Icon name="chevron-left" size={16} />
          {utcLabel(prev.offsetMinutes)}
        </button>
      ) : null}
      {next ? (
        <button type="button" className={cn('t2f-focus', m.navBtn)} aria-label={t('nextZone', { offset: utcLabel(next.offsetMinutes) })} onClick={() => onSelect(next.id)}>
          {utcLabel(next.offsetMinutes)}
          <Icon name="chevron-right" size={16} />
        </button>
      ) : null}
    </span>
  );
  const close = <IconButton icon="close" aria-label={t('close')} onClick={onClose} className={m.close} />;
  return (
    <section ref={ref} className={cn(m.panel, phone && m.phone)} data-zone-panel={zone.id} data-state={state} aria-label={t('aria', { offset })}>
      {phone ? (
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
            <Stat n={zone.countries.length} label={t('countriesWord', { count: zone.countries.length })} />
            <Stat n={zone.streamCount ?? streams.length} label={t('streamsWord', { count: zone.streamCount ?? streams.length })} />
            <Stat n={zone.cityCount ?? 0} label={t('citiesWord', { count: zone.cityCount ?? 0 })} />
          </dl>
        </div>
        <div className={m.watchCol}>
          <h4 className={m.h4}>{t('watchTitle')}</h4>
          {state === 'past' ? (
            <p className={m.empty}>{t('streamsDone')}</p>
          ) : streams.length === 0 ? (
            <p className={m.empty}>{t('noStreams')}</p>
          ) : (
            <Slider phone={phone} label={t('watchTitle')}>
              {streams.map((s) => (
                <StreamCard key={s.cityId} stream={s} live={state === 'live'} midnightMs={zone.midnightMs} />
              ))}
            </Slider>
          )}
        </div>
      </div>
      <Countries zone={zone} phone={phone} />
    </section>
  );
}

function StateBadge({ state }: { state: ZoneState }) {
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
        <div className={m.ago}>{t('pastAgo', { dur: formatDurationShort(now - zone.midnightMs, locale) })}</div>
        <div className={m.when}>{t('pastAt', { time: formatClock(zone.midnightMs, { locale }) })}</div>
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

/** Стрічка, що гортається вбік; на десктопі — стрілки, коли карток більше, ніж уміщається. */
function Slider({ phone, label, children }: { phone: boolean; label: string; children: ReactNode }) {
  const t = useTranslations('liveMap.panel');
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const upd = () => setEdge({ start: el.scrollLeft <= 2, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
    upd();
    el.addEventListener('scroll', upd, { passive: true });
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(upd) : null;
    ro?.observe(el);
    return () => {
      el.removeEventListener('scroll', upd);
      ro?.disconnect();
    };
  }, []);
  const go = (dir: 1 | -1) => {
    const el = ref.current;
    if (el) el.scrollBy({ left: dir * el.clientWidth, behavior: 'smooth' });
  };
  const arrows = !phone && !(edge.start && edge.end);
  return (
    <div className={m.slider} data-slider-arrows={arrows ? 'true' : 'false'}>
      <ul ref={ref} className={cn(m.track, phone && m.trackPhone)} aria-label={label}>
        {children}
      </ul>
      {arrows ? (
        <>
          <button type="button" className={cn('t2f-focus', m.arrow, m.arrowPrev)} aria-label={t('slidePrev')} disabled={edge.start} onClick={() => go(-1)}>
            <Icon name="chevron-left" size={18} />
          </button>
          <button type="button" className={cn('t2f-focus', m.arrow, m.arrowNext)} aria-label={t('slideNext')} disabled={edge.end} onClick={() => go(1)}>
            <Icon name="chevron-right" size={18} />
          </button>
        </>
      ) : null}
    </div>
  );
}

function StreamCard({ stream, live, midnightMs }: { stream: MapStream; live: boolean; midnightMs: number }) {
  const t = useTranslations('liveMap.panel');
  const tType = useTranslations('liveCards.eventCard.type');
  const locale = useLocale();
  return (
    <li className={m.card} data-stream-card={stream.cityId}>
      <div className={m.cardTop}>
        <span className={m.cardType}>{tType(TYPE_KEY[stream.type])}</span>
        {live ? (
          <span className={m.cardLive}>
            <span aria-hidden="true" className={m.dotLive} />
            {t('live')}
          </span>
        ) : null}
      </div>
      <div className={m.cardCity}>{stream.city}</div>
      <div className={m.cardCountry}>
        <Flag code={stream.flagCode} round diameter={18} decorative />
        {stream.country}
      </div>
      {live ? null : (
        <div className={m.cardWhen}>
          <Icon name="clock" size={14} />
          {t('startsAt', { time: formatClock(midnightMs, { locale }) })}
        </div>
      )}
      <NextLink href={stream.href} className={cn('t2f-focus', m.cardBtn, live && m.cardBtnLive)}>
        {live ? <Icon name="play" size={12} /> : null}
        {live ? t('watch') : t('countryPage')}
      </NextLink>
    </li>
  );
}

/** Країни поясу: найпопулярніші — картками, усі інші — плитками за регіонами. Клік — сторінка країни. */
function Countries({ zone, phone }: { zone: MapZone; phone: boolean }) {
  const t = useTranslations('liveMap.panel');
  const tR = useTranslations('liveMap.regions');
  const [more, setMore] = useState(false);
  const top = zone.countries.slice(0, TOP);
  const rest = zone.countries.slice(TOP);
  const groups = new Map<RegionKey | 'other', MapCountry[]>();
  for (const c of rest) {
    const r = regionOf(c.iso, zone.offsetMinutes) ?? 'other';
    groups.set(r, [...(groups.get(r) ?? []), c]);
  }
  const ordered = [...REGION_ORDER, 'other' as const].filter((r) => groups.has(r)).map((r) => ({ key: r, list: groups.get(r)! }));
  const shown = phone ? ordered.slice(0, PHONE_GROUPS) : ordered;
  const hidden = phone ? ordered.slice(PHONE_GROUPS) : [];
  const hiddenCount = hidden.reduce((n, g) => n + g.list.length, 0);
  const streamIsos = new Set((zone.streams ?? []).map((s) => s.iso));
  const group = (g: { key: RegionKey | 'other'; list: MapCountry[] }) => (
    <div key={g.key} className={m.region} data-region={g.key}>
      <h5 className={m.smallCap}>
        {tR(g.key)} · {g.list.length}
      </h5>
      <ul className={cn(m.tiles, phone && m.tilesPhone)}>
        {g.list.map((c) => (
          <li key={c.iso}>
            <NextLink href={c.href} className={cn('t2f-focus', m.tile)} data-country-tile={c.iso}>
              <Flag code={c.flagCode} round diameter={22} decorative />
              <span className={m.tileName}>{c.name}</span>
              {streamIsos.has(c.iso) ? (
                <span className={m.tilePlay} aria-label={t('hasStream')}>
                  <Icon name="play" size={12} />
                </span>
              ) : null}
            </NextLink>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <div className={m.countries}>
      <div className={m.countriesHead}>
        <h4 className={m.h4}>{t('countriesTitle')}</h4>
        <span className={m.countriesNote}>{t('countriesNote', { count: zone.countries.length })}</span>
      </div>
      <ul className={cn(m.shelf, phone && m.shelfPhone)}>
        {top.map((c) => (
          <li key={c.iso} className={m.shelfItem}>
            <NextLink href={c.href} className={cn('t2f-focus', m.topCard)} data-country-card={c.iso}>
              <Flag code={c.flagCode} round diameter={40} decorative />
              <span className={m.topName}>{c.name}</span>
              {c.city ? <span className={m.topCity}>{c.city}</span> : null}
              {streamIsos.has(c.iso) ? (
                <span className={m.topStream}>
                  <Icon name="play" size={12} />
                  {t('streamYes')}
                </span>
              ) : (
                <span className={m.topNoStream}>{t('streamNo')}</span>
              )}
            </NextLink>
          </li>
        ))}
      </ul>
      {ordered.length ? <div className={cn(m.smallCap, m.restTitle)}>{t('restTitle')}</div> : null}
      {shown.map(group)}
      {hidden.length ? (
        <>
          <Reveal open={more}>{hidden.map(group)}</Reveal>
          <button type="button" className={cn('t2f-focus', m.moreBtn)} aria-expanded={more} onClick={() => setMore((v) => !v)}>
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
