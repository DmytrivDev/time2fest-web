'use client';

/**
 * «Мій графік» (`/schedule/`) за дошками `Desk-Schedule-New` / `Phone-Schedule-New` v4 (рішення власника 2026-11-06,
 * концепція `schedule-concept-2026-11-06.md`):
 * - заголовок і підсумок (без пасу — «Графік — у Новорічному пасі · Оформити пас»);
 * - «Твій шлях»: мапа поясів, зустрінуті — золото, у графіку — біло-сірі, «Зараз» — червоне кільце; лінія через вузли
 *   поясів, інші країни поясу — промені (варіант B). Свій шлях видно й без пасу (рішення 2026-10-27) — лише зі штампами;
 * - «Попереду»: усі пояси від найближчої півночі; пояс — акордеон: згорнутий — стан, час, UTC, кружки слотів (прапор —
 *   країна, пунктир — вільне місце), «N з K»; поточний пояс на старті розгорнутий (згорнути можна). Слотів стільки, скільки країн у поясі, але
 *   не більше 4. Розгорнутий — слоти в ряд (телефон 2 × 2): країна (прапор, назва, місто, стан) або «+ Додати країну»;
 *   «+» відкриває країни поясу на місці чату (телефон — шторкою), без пасу — вікно пасу;
 * - «Уже зустріли»: пояси з країнами графіка чи штампами — зі станом штампа; решта згорнута в один рядок.
 * Чат — як на інших сторінках без плеєра.
 */
import NextLink from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo, useState, type CSSProperties } from 'react';
import { PageChat } from '@/components/chat/PageChat';
import { scheduleClosed } from '@/components/live/CalendarButton';
import { StateSwatch } from '@/components/live/MapSide';
import { PathMap } from '@/components/live/PathMap';
import { PathLock } from '@/components/passport/PathLock';
import { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useGetPass } from '@/components/pass/PassWindow';
import { cn } from '@/components/primitives/cn';
import { Flag } from '@/components/primitives/Flag';
import { Icon } from '@/components/primitives/Icon';
import { useOverlay } from '@/components/shell/OverlayManager';
import { routeCities } from '@/lib/chat-sim/authorPath';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { zoneState, type ZoneState } from '@/lib/engine/zoneState';
import { formatClock, utcLabel, viewerZoneLabel } from '@/lib/i18n/time';
import { formatUsd, PASS_PRICE } from '@/lib/offers/format';
import { scheduledCountries, zoneSlotCount } from '@/lib/schedule/countryZone';
import { scheduleCountry, type ScheduleCountry } from '@/lib/schedule/scheduleCountry';
import { buildSchedulePath } from '@/lib/schedule/schedulePath';
import { useNow, useTimeReady } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { SCHEDULE_ZONE_ID, useScheduleReplace } from './scheduleReplace';
import { ZoneCountriesPanel, ZoneCountriesSub } from './ScheduleWindows';
// Кольорові зразки стану поясу (`StateSwatch`) — ті самі, що в легенді мапи.
import '@/components/live/ZoneMap.css';
import s from './schedule.module.css';

type SlotState = 'live' | 'main' | 'webcam' | 'countdown' | 'stamp' | 'missed';
interface SlotItem {
  c: ScheduleCountry;
  state: SlotState;
}
interface ZoneItem {
  id: string;
  offsetMinutes: number;
  midnightMs: number;
  state: ZoneState;
  slots: number;
  items: SlotItem[];
}

const SLOT_ICON: Record<SlotState, 'broadcast-live' | 'broadcast' | 'clock' | 'stamp'> = {
  live: 'broadcast-live',
  main: 'broadcast',
  webcam: 'broadcast',
  countdown: 'clock',
  stamp: 'stamp',
  missed: 'clock',
};

function stampOf(stamps: readonly Stamp[], zoneId: string, iso: string): Stamp | undefined {
  const data = getData();
  return stamps.find((st) => st.countryIso === iso && data.eventsById.get(st.eventId)?.zoneId === zoneId);
}

export function SchedulePage() {
  const t = useTranslations('schedulePage');
  const tType = useTranslations('liveCards.eventCard.type');
  const tA = useTranslations('windows.author');
  const locale = useLocale();
  const ready = useTimeReady();
  const now = useNow({ granularity: 'minute' });
  const hasPass = useGuestStore((g) => g.hasPass);
  const scheduleRaw = useGuestStore((g) => g.schedule);
  const stamps = useGuestStore((g) => g.stamps);
  const schedule = useMemo(() => (hasPass ? scheduleRaw : []), [hasPass, scheduleRaw]);
  const replacing = useScheduleReplace((r) => r.eventId);
  const passWindows = useOfferWindows();
  const overlay = useOverlay();
  const getPass = useGetPass();
  const data = getData();
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [showRest, setShowRest] = useState(false);

  // Пояси з країнами графіка (і штампами — для тих, що минули).
  const zones = useMemo<ZoneItem[]>(() => {
    return data.zones.map((z) => {
      const state: ZoneState = now > 0 ? zoneState(now, z, data.zones) : 'future';
      const past = state === 'past';
      const inSched = scheduledCountries(schedule, z.id, data);
      const stamped = past ? stamps.filter((st) => data.eventsById.get(st.eventId)?.zoneId === z.id).map((st) => st.countryIso) : [];
      const isos = [...new Set([...inSched, ...stamped])];
      const items = isos
        .map((iso) => {
          const c = scheduleCountry(data, iso, z.id, now);
          if (!c) return null;
          let st: SlotState = c.group;
          if (past) {
            const stamp = stampOf(stamps, z.id, iso);
            st = stamp ? 'stamp' : 'missed';
          }
          return { c, state: st };
        })
        .filter((x): x is SlotItem => x !== null);
      return { id: z.id, offsetMinutes: z.offsetMinutes, midnightMs: z.midnightMs, state, slots: zoneSlotCount(z.id, data), items };
    });
  }, [data, now, schedule, stamps]);

  const ahead = zones.filter((z) => z.state !== 'past').sort((a, b) => a.midnightMs - b.midnightMs);
  const pastAll = zones.filter((z) => z.state === 'past').sort((a, b) => b.midnightMs - a.midnightMs);
  const pastWith = pastAll.filter((z) => z.items.length > 0);
  const pastRest = pastAll.filter((z) => z.items.length === 0);

  const countryCount = zones.reduce((n, z) => n + (z.state === 'past' ? 0 : z.items.length), 0);
  const zoneCount = zones.filter((z) => z.state !== 'past' && z.items.length > 0).length;

  const path = useMemo(() => buildSchedulePath(stamps, schedule, data, now), [stamps, schedule, data, now]);
  const zoneStates = useMemo(() => Object.fromEntries(zones.map((z) => [z.id, z.state])), [zones]);
  const met = path.filter((p) => !p.planned);
  const planned = path.filter((p) => p.planned);
  const route = routeCities(met.filter((p) => !p.hubOf), 3).met.join(' → ');
  const nextHub = planned.find((p) => !p.hubOf && p.midnightMs >= now);

  const openZone = useCallback(
    (zoneId: string) => {
      if (!useGuestStore.getState().hasPass) {
        passWindows.openScheduleGate();
        return;
      }
      const z = data.zonesById.get(zoneId);
      if (!z) return;
      const title = t('zone.title', { time: formatClock(z.midnightMs, { locale }), utc: utcLabel(z.offsetMinutes) });
      const show = () =>
        overlay.open({
          id: SCHEDULE_ZONE_ID,
          kind: 'accent',
          chrome: 'board',
          title,
          description: <ZoneCountriesSub zoneId={zoneId} />,
          content: <ZoneCountriesPanel zoneId={zoneId} onToggle={(eventId) => passWindows.requestSchedule(eventId, undefined, show)} />,
        });
      show();
    },
    [data, locale, overlay, passWindows, t],
  );

  const toggleOpen = (id: string) =>
    setOpen((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const slotLabel = (it: SlotItem) =>
    it.state === 'live'
      ? t('zone.live')
      : it.state === 'main'
        ? tType('main')
        : it.state === 'webcam'
          ? tType('webcam')
          : it.state === 'countdown'
            ? tType('countdownOnly')
            : it.state === 'stamp'
              ? t('stamp')
              : t('missed');

  const replacingZone = replacing ? data.eventsById.get(replacing)?.zoneId : undefined;

  const zoneRow = (z: ZoneItem, opts: { past?: boolean; plain?: boolean } = {}) => {
    const past = !!opts.past;
    // Поточний пояс на старті розгорнутий, але його можна згорнути (правка власника 2026-11-07): `open` для нього — «перемкнуто».
    const startOpen = z.state === 'live';
    const isOpen = !opts.plain && (startOpen !== open.has(z.id));
    const time = formatClock(z.midnightMs, { locale });
    const utc = utcLabel(z.offsetMinutes);
    const tag = z.state === 'live' ? t('now') : z.state === 'next' ? t('next') : null;
    const closed = scheduleClosed(z.midnightMs, now);
    const free = past ? 0 : Math.max(0, z.slots - z.items.length);
    const panelId = `schedule-zone-${z.id}`;
    const cols = Math.max(1, past ? z.items.length : z.slots);
    const rings = (
      <span className={s.rings} aria-hidden="true">
        {z.items.map((it) => (
          <span key={it.c.iso} className={s.ring} data-state={it.state}>
            <Flag code={it.c.flagCode} diameter={22} decorative />
          </span>
        ))}
        {Array.from({ length: free }, (_, i) => (
          <span key={`free-${i}`} className={s.ringFree} />
        ))}
      </span>
    );
    const head = (
      <>
        <StateSwatch state={past ? 'past' : z.state} className={s.sw} />
        <span className={s.when}>
          <span className={s.timeLine}>
            <b className={s.time}>{t('at', { time })}</b>
            {tag ? <span className={cn(s.tag, z.state === 'live' ? s.tagLive : s.tagNext)}>{tag}</span> : null}
          </span>
          <span className={s.utc}>{utc}</span>
        </span>
        {rings}
        <span className={s.headSpacer} />
        {!past && hasPass ? (
          <span className={s.count} aria-label={t('slotsAria', { count: z.items.length, limit: z.slots })}>
            {t('slots', { count: z.items.length, limit: z.slots })}
          </span>
        ) : null}
        {opts.plain ? null : <Icon name={isOpen ? 'chevron-up' : 'chevron-down'} size={18} className={s.chev} />}
      </>
    );
    return (
      <li key={z.id} className={cn(s.zone, isOpen && s.zoneOpen, past && !isOpen && s.zonePast)} data-zone={z.id} data-state={past ? 'past' : z.state} data-open={isOpen ? 'true' : undefined}>
        {opts.plain ? (
          <div className={s.head}>{head}</div>
        ) : (
          <button type="button" aria-expanded={isOpen} aria-controls={panelId} onClick={() => toggleOpen(z.id)} className={cn('t2f-focus', s.head, s.headBtn)}>
            {head}
          </button>
        )}
        {opts.plain ? null : (
          // Плавне розгортання (правило сайту: акордеони відкриваються плавно; «Зменшити рух» — без анімації).
          <div className={s.body} data-open={isOpen ? 'true' : undefined}>
            <div className={s.bodyInner} inert={!isOpen}>
          <ul id={panelId} className={s.slots} style={{ '--cols': cols } as CSSProperties}>
            {z.items.map((it) => (
              <li key={it.c.iso} className={cn(s.slot, it.state === 'stamp' && s.slotGold, it.state === 'missed' && s.slotMissed)} data-slot={it.c.iso}>
                <NextLink href={it.c.href} className={cn('t2f-focus', s.slotLink)}>
                  <span className={s.slotName}>
                    <Flag code={it.c.flagCode} diameter={22} decorative />
                    <b>{it.c.name}</b>
                  </span>
                  <span className={s.slotCity}>{it.c.place.split(' · ')[0]}</span>
                  <span className={cn(s.slotState, it.state === 'live' && s.slotStateLive, it.state === 'stamp' && s.slotStateGold)}>
                    <Icon name={SLOT_ICON[it.state]} size={14} />
                    <span className={s.ellipsis}>{slotLabel(it)}</span>
                  </span>
                </NextLink>
                {!past && replacingZone === z.id ? (
                  <button type="button" onClick={() => passWindows.replaceInSchedule(it.c.iso)} className={cn('t2f-focus t2f-press', s.slotReplace)}>
                    <Icon name="swap" size={14} />
                    {t('replace')}
                  </button>
                ) : null}
                {!past && !closed && replacingZone !== z.id ? (
                  <button
                    type="button"
                    aria-label={t('remove', { country: it.c.name })}
                    onClick={() => passWindows.requestSchedule(it.c.eventId)}
                    className={cn('t2f-focus', s.slotX)}
                  >
                    <Icon name="close" size={12} strokeWidth={2.4} />
                  </button>
                ) : null}
              </li>
            ))}
            {Array.from({ length: free }, (_, i) => (
              <li key={`free-${i}`} className={s.slotFreeItem}>
                <button
                  type="button"
                  disabled={!!closed}
                  aria-label={t('addAria', { time })}
                  onClick={() => openZone(z.id)}
                  className={cn('t2f-focus t2f-press', s.slotFree)}
                >
                  <Icon name="plus" size={18} strokeWidth={2.2} />
                  <span className={s.addLong}>{t('addCountry')}</span>
                  <span className={s.addShort}>{t('addShort')}</span>
                </button>
              </li>
            ))}
          </ul>
            </div>
          </div>
        )}
      </li>
    );
  };

  const zoneLabel = ready ? viewerZoneLabel() : '';
  return (
    // `data-skeleton` — поки час не відомий (статичний HTML до гідратації): той самий маркер, що в `loading.tsx` (2026-11-10).
    <div className={s.page} data-schedule-page="" data-skeleton={ready ? undefined : 'schedule'}>
      <header className={s.top}>
        <h1 className={s.h1}>{t('title')}</h1>
        {hasPass ? (
          <p className={s.subtitle}>
            {countryCount > 0 ? t('subtitle', { countries: countryCount, zones: zoneCount, zone: zoneLabel }) : t('subtitleEmpty', { zone: zoneLabel })}
          </p>
        ) : (
          <p className={s.subtitle}>
            {t('noPass')} ·{' '}
            <button type="button" onClick={() => getPass()} className={cn('t2f-focus', s.inlineLink)}>
              {t('getPass', { price: formatUsd(PASS_PRICE) })}
            </button>
          </p>
        )}
      </header>

      <section className={s.pathCard} aria-labelledby="schedule-path-title" data-schedule-path="">
        <div className={s.pathHead}>
          <h2 id="schedule-path-title" className={s.pathTitle}>
            {t('path.title')}
          </h2>
          <span className={s.pathCounts}>
            {met.length || planned.length
              ? hasPass
                ? t('path.counts', { met: new Set(met.map((p) => p.flagCode)).size, planned: planned.length })
                : t('path.countsMet', { met: new Set(met.map((p) => p.flagCode)).size })
              : t('path.empty')}
          </span>
          <NextLink href="/passport/" className={cn('t2f-focus', s.passportLink)}>
            {t('path.passport')}
            <Icon name="chevron-right" size={14} />
          </NextLink>
        </div>
        {/* Мапа в рамці, легенда — під рискою в тій самій рамці (правка власника 2026-11-06). Мапа шляху — у пасі
            (рішення власника 2026-11-07): без пасу затемнена, без точок, з карткою пасу; з пасом — і відвідані країни. */}
        <div className={s.mapFrame}>
          <div className={s.mapWrap}>
            <PathMap
              points={path}
              authorName=""
              summary={route || t('path.empty')}
              zoneStates={zoneStates}
              visited={stamps.map((st) => ({ zoneId: data.eventsById.get(st.eventId)?.zoneId ?? '', iso: st.countryIso }))}
              locked={!hasPass}
              className={s.map}
            />
            {!hasPass ? <PathLock variant="schedule" /> : null}
          </div>
          {hasPass ? (
          <div className={s.mapFoot}>
        <ul className={s.legend} aria-hidden="true">
          <li>
            <span className={s.legDot} />
            {tA('legendMet')}
          </li>
          {hasPass ? (
            <li>
              <span className={s.legRing} />
              {tA('legendSchedule')}
            </li>
          ) : null}
          <li>
            <span className="t2f-pathmap-legend-now" />
            {t('path.legendNow')}
          </li>
        </ul>
        <ul className={cn(s.legend, s.legendZones)} aria-hidden="true">
          <li>
            <span className={s.zoneSw} data-state="visited" />
            {t('path.zoneVisited')}
          </li>
          <li>
            <span className={s.zoneSw} data-state="past" />
            {t('path.zonePast')}
          </li>
          <li>
            <span className={s.zoneSw} data-state="live" />
            {t('path.zoneNow')}
          </li>
          <li>
            <span className={s.zoneSw} data-state="future" />
            {t('path.zoneAhead')}
          </li>
        </ul>
          </div>
          ) : null}
        </div>
        {hasPass && (route || nextHub) ? (
          <div className={s.route}>
            {route ? <b>{route}</b> : null}
            {nextHub ? (
              <span className={s.routeNext}>
                {t('path.next', { city: nextHub.city, when: t('at', { time: formatClock(nextHub.midnightMs, { locale }) }) })}
                {planned.length > 1 ? ` · ${t('path.more', { count: planned.length - 1 })}` : ''}
              </span>
            ) : null}
          </div>
        ) : null}
      </section>

      <section aria-labelledby="schedule-ahead" className={s.section}>
        <div className={s.sectionHead}>
          <h2 id="schedule-ahead" className={s.h2}>
            {t('ahead')}
          </h2>
          <span className={s.sectionSub}>{t('zonesCount', { count: ahead.length })}</span>
        </div>
        <ul className={s.zones}>{ahead.map((z) => zoneRow(z))}</ul>
      </section>

      {pastAll.length ? (
        <section aria-labelledby="schedule-past" className={s.section}>
          <div className={s.sectionHead}>
            <h2 id="schedule-past" className={s.h2}>
              {t('past')}
            </h2>
            <span className={s.sectionSub}>{t('zonesCount', { count: pastAll.length })}</span>
          </div>
          <ul className={s.zones}>
            {pastWith.map((z) => zoneRow(z, { past: true }))}
            {showRest ? pastRest.map((z) => zoneRow(z, { past: true, plain: true })) : null}
          </ul>
          {pastRest.length ? (
            <button type="button" aria-expanded={showRest} onClick={() => setShowRest((v) => !v)} className={cn('t2f-focus', s.rest)}>
              {showRest ? t('restHide') : t('restZones', { count: pastRest.length })}
              <Icon name={showRest ? 'chevron-up' : 'chevron-down'} size={16} />
            </button>
          ) : null}
        </section>
      ) : null}
      <PageChat />
    </div>
  );
}

