'use client';

import { useLocale, useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode, Ref } from 'react';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import type { ZoneState } from '@/lib/engine/zoneState';
import { formatDurationShort, formatTimeForViewer, viewerTimeZone } from '@/lib/i18n/time';
import { utcLabel, type MapCity, type MapCountry, type MapZone } from './MapModel';
import m from './zoneMap.module.css';

/** Що під курсором: пояс (смуга в океані), країна (суходіл чи морська область острівної країни) або точка міста. */
export type MapTipTarget =
  | { kind: 'zone'; zoneId: string }
  | { kind: 'country'; zoneId: string; iso: string }
  | { kind: 'city'; zoneId: string; cityId: string };

export const tipKey = (t: MapTipTarget | null): string | null =>
  t ? (t.kind === 'zone' ? `z:${t.zoneId}` : t.kind === 'country' ? `c:${t.zoneId}:${t.iso}` : `m:${t.cityId}`) : null;

/** Фаза поясу для тексту плашки: «в ефірі» до півночі й 15 хв після неї (`zoneState`) — два різні тексти. */
export type TipPhase = 'future' | 'next' | 'liveBefore' | 'liveAfter' | 'past';

export function tipPhase(state: ZoneState, midnightMs: number, now: number): TipPhase {
  if (state === 'live') return now < midnightMs ? 'liveBefore' : 'liveAfter';
  if (state === 'past' || now >= midnightMs + HANDOVER_AFTER) return 'past';
  return state;
}

/** Зсув часу пристрою від UTC (хв) у момент `ms` — щоб позначити «ваш пояс». */
export function viewerOffsetAt(ms: number, timeZone: string = viewerTimeZone()): number | null {
  try {
    const name = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
      .formatToParts(ms)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!name || name === 'GMT') return 0;
    const mt = /GMT([+-])(\d{2}):(\d{2})/.exec(name);
    if (!mt) return null;
    const v = Number(mt[2]) * 60 + Number(mt[3]);
    return mt[1] === '-' ? -v : v;
  } catch {
    return null;
  }
}

/** Прапори країн поясу за популярністю, країна гостя — першою. */
export function orderTipFlags(countries: readonly MapCountry[], viewerIso?: string | null): MapCountry[] {
  if (!viewerIso) return [...countries];
  const own = countries.find((c) => c.iso === viewerIso);
  return own ? [own, ...countries.filter((c) => c !== own)] : [...countries];
}

const MAX_FLAGS = 5;

function StateMark({ phase }: { phase: TipPhase }) {
  if (phase === 'liveBefore' || phase === 'liveAfter') return <span aria-hidden="true" className={m.tipDotLive} />;
  if (phase === 'next')
    return (
      <svg aria-hidden="true" className={m.tipClock} viewBox="0 0 24 24" width="0.75rem" height="0.75rem" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </svg>
    );
  return <span aria-hidden="true" className={cn(m.tipSquare, phase === 'past' ? m.tipSquarePast : m.tipSquareFuture)} />;
}

function StreamsRow({ count, live }: { count: number; live: boolean }) {
  const t = useTranslations('liveMap.tip');
  return (
    <div className={cn(m.tipRow, m.tipRowQuiet)} data-tip-streams={count}>
      {live ? (
        <span aria-hidden="true" className={m.tipDotLive} />
      ) : (
        <svg aria-hidden="true" viewBox="0 0 24 24" width="0.75rem" height="0.75rem" className={m.tipPlay}>
          <path d="M7 5v14l12-7z" fill="currentColor" />
        </svg>
      )}
      <span>{t(live ? 'streamsLive' : 'streams', { count })}</span>
    </div>
  );
}

function useWhen(midnightMs: number, now: number) {
  const t = useTranslations('liveMap.tip');
  const locale = useLocale();
  const v = formatTimeForViewer(midnightMs, { now: now > 0 ? now : midnightMs, locale });
  return { time: v.time, at: v.date ? t('atDate', { time: v.time, date: v.date }) : t('at', { time: v.time }) };
}

/** Плашка поясу (рішення власника 2026-11-02, дошка `Desk-Map-Tips`). */
export function ZoneTip({ zone, state, now, viewerIso }: { zone: MapZone; state: ZoneState; now: number; viewerIso?: string | null }) {
  const t = useTranslations('liveMap.tip');
  const locale = useLocale();
  const phase = tipPhase(state, zone.midnightMs, now);
  const when = useWhen(zone.midnightMs, now);
  const dur = formatDurationShort(Math.abs(zone.midnightMs - now), locale);
  const line =
    phase === 'future'
      ? t('zoneFuture', { dur })
      : phase === 'next'
        ? t('zoneNext', { dur })
        : phase === 'liveBefore'
          ? t('zoneLiveBefore', { dur })
          : phase === 'liveAfter'
            ? t('zoneLiveAfter')
            : t('zonePast', { dur });
  const own = now > 0 && viewerOffsetAt(zone.midnightMs) === zone.offsetMinutes;
  const flags = orderTipFlags(zone.countries, viewerIso);
  const more = Math.max(0, flags.length - MAX_FLAGS);
  const streams = phase === 'past' ? 0 : (zone.streamCount ?? 0);
  return (
    <>
      <div className={m.tipHead}>
        <span className={m.tipTitle}>{utcLabel(zone.offsetMinutes)}</span>
        {own ? <span className={m.tipOwn} data-tip-own="">{t('yourZone')}</span> : null}
      </div>
      <div className={cn(m.tipRow, phase === 'past' && m.tipRowPast)} data-tip-phase={phase}>
        <StateMark phase={phase} />
        <span>{line}</span>
      </div>
      <div className={m.tipSub}>{when.at}</div>
      <div className={m.tipFlags} data-tip-flags={Math.min(MAX_FLAGS, flags.length)}>
        {flags.slice(0, MAX_FLAGS).map((c, i) => (
          <span key={c.iso} className={m.tipFlag} style={{ zIndex: MAX_FLAGS - i }}>
            <Flag code={c.flagCode} diameter={22} decorative />
          </span>
        ))}
        {more ? <span className={m.tipMore}>{t('moreCountries', { count: more })}</span> : null}
      </div>
      {streams ? <StreamsRow count={streams} live={phase === 'liveBefore' || phase === 'liveAfter'} /> : null}
    </>
  );
}

/** Плашка країни: пояс тієї частини, де курсор (і скільки ще поясів), час до півночі з родом, головне місто. */
export function CountryTip({
  zone,
  country,
  state,
  now,
  zoneCount,
}: {
  zone: MapZone;
  country: MapCountry;
  state: ZoneState;
  now: number;
  zoneCount: number;
}) {
  const t = useTranslations('liveMap.tip');
  const locale = useLocale();
  const phase = tipPhase(state, zone.midnightMs, now);
  const when = useWhen(zone.midnightMs, now);
  const dur = formatDurationShort(Math.abs(zone.midnightMs - now), locale);
  const gender = country.gender ?? 'other';
  const line =
    phase === 'future' || phase === 'next'
      ? t('countryFuture', { dur, time: when.time })
      : phase === 'liveBefore'
        ? t('countryLiveBefore', { dur })
        : phase === 'liveAfter'
          ? t('countryLiveAfter', { gender })
          : t('countryPast', { gender, dur });
  const offset = utcLabel(zone.offsetMinutes);
  const live = phase === 'liveBefore' || phase === 'liveAfter';
  const city = phase !== 'past' && country.mainCity ? country.mainCity : null;
  return (
    <>
      <div className={m.tipHead}>
        <Flag code={country.flagCode} diameter={24} decorative />
        <span className={m.tipTitle}>{country.name}</span>
      </div>
      <div className={m.tipSub} data-tip-zones={zoneCount}>
        {zoneCount > 1 ? t('countryZones', { offset, count: zoneCount - 1 }) : offset}
      </div>
      <div className={cn(m.tipRow, phase === 'past' && m.tipRowPast)} data-tip-phase={phase}>
        <StateMark phase={phase} />
        <span>{line}</span>
      </div>
      {city ? (
        <div className={cn(m.tipRow, m.tipRowQuiet)} data-tip-city="">
          {live ? (
            <span aria-hidden="true" className={m.tipDotLive} />
          ) : (
            <svg aria-hidden="true" viewBox="0 0 24 24" width="0.75rem" height="0.75rem" className={m.tipPlay}>
              <path d="M7 5v14l12-7z" fill="currentColor" />
            </svg>
          )}
          <span>{t(live ? 'cityLive' : 'cityStream', { city })}</span>
        </div>
      ) : null}
    </>
  );
}

const CITY_TYPE = { main: 'main', webcam: 'webcam', tv: 'tv', 'countdown-only': 'countdownOnly' } as const;

/**
 * Плашка міста (рішення власника 2026-11-03, дошка `Desk-Map-CityTips`, варіант A — без кадру ефіру): місто, пам’ятка й
 * країна, стан трансляції, тип. Рядка «що буде після кліку» немає — над містом курсор-«рука».
 */
export function CityTip({ city, zone, country, state, now }: { city: MapCity; zone: MapZone; country?: MapCountry; state: ZoneState; now: number }) {
  const t = useTranslations('liveMap.tip');
  const tType = useTranslations('liveCards.eventCard.type');
  const locale = useLocale();
  const phase = tipPhase(state, zone.midnightMs, now);
  const when = useWhen(zone.midnightMs, now);
  const dur = formatDurationShort(Math.abs(zone.midnightMs - now), locale);
  const stream = city.stream === 'live';
  const line = stream
    ? phase === 'liveBefore'
      ? t('cityLiveBefore', { dur })
      : phase === 'liveAfter'
        ? t('cityLiveAfter')
        : phase === 'past'
          ? t('cityPast', { dur })
          : t('cityAhead', { time: when.time, dur })
    : phase === 'past'
      ? t('cityPast', { dur })
      : phase === 'liveAfter'
        ? t('cityQuietAfter')
        : t('cityQuiet', { dur });
  const where = [city.landmark, country?.name].filter(Boolean).join(' · ');
  return (
    <>
      <div className={m.tipHead}>
        {country ? <Flag code={country.flagCode} diameter={20} decorative /> : null}
        <span className={m.tipTitle}>{city.name}</span>
      </div>
      {where ? <div className={m.tipSub}>{where}</div> : null}
      <div className={cn(m.tipRow, (phase === 'past' || !stream) && m.tipRowPast)} data-tip-phase={phase}>
        {stream ? <StateMark phase={phase} /> : <span aria-hidden="true" className={cn(m.tipSquare, m.tipSquarePast)} />}
        <span>{line}</span>
      </div>
      {stream && phase === 'past' ? (
        <div className={cn(m.tipRow, m.tipRowQuiet)} data-tip-replay="">
          <svg aria-hidden="true" viewBox="0 0 24 24" width="0.75rem" height="0.75rem" className={m.tipPlay}>
            <path d="M7 5v14l12-7z" fill="currentColor" />
          </svg>
          <span>{t('cityReplay')}</span>
        </div>
      ) : null}
      {stream ? <div className={m.tipSub}>{tType(CITY_TYPE[city.celebrationType])}</div> : null}
    </>
  );
}

/** Рамка плашки: позицію задає мапа (за курсором — напряму в DOM, без перемальовування мапи). */
export function MapTip({ ref, children, style, kind }: { ref?: Ref<HTMLDivElement>; children: ReactNode; style?: CSSProperties; kind: string }) {
  return (
    <div ref={ref} aria-hidden="true" className={m.tip} style={style} data-zone-map-tip={kind}>
      {children}
    </div>
  );
}
