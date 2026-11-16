'use client';

/**
 * Імітація сервера сповіщень (шов, `docs/backend/frontend-seam.md`): у `http` ці сповіщення створює бекенд, тому
 * генератор монтує лише `SimRuntime` у режимі `sim`. Раніше — `components/notifications/NotificationsWatcher` (без змін).
 * Створює сповіщення (рішення власника 2026-11-09), поки сайт відкритий: дивиться на штампи, графік і чат.
 * - штамп у паспорті → «Штамп «Японія» в паспорті»;
 * - досягнення паспорта → 3 / 5 / 10 країн, 3 / 5 / 10 поясів (континентів у даних ще немає);
 * - серія за свято → 3 / 5 півночей поспіль (поясів підряд зі штампом);
 * - трансляція з графіка почалась → за 15 хв до півночі події з графіка («наживо»);
 * - відповідь у чаті → нове повідомлення з `replyTo` на мій нік.
 * Вимкнені в налаштуваннях типи `push` пропускає сам.
 */
import { useEffect, useRef } from 'react';
import { useChatFeed } from '@/lib/chat-sim/store';
import { countryHref as countryPageHref } from '@/lib/live/countryHref';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { HOWTO_BEFORE } from '@time2fest/rules/time';
import { formatClock } from '@/lib/i18n/time';
import { useClock, useNow } from '@/lib/time/TimeProvider';
import { useGuestStore } from '@/stores/guest';
import { useNotifStore } from '@/stores/notifications';

const COUNTRY_GOALS = [3, 5, 10];
const ZONE_GOALS = [3, 5, 10];
const STREAK_GOALS = [3, 5];

/** Сторінка країни саме з цією подією (місто й пояс), `lib/live/countryHref`. */
function countryHref(iso: string, eventId: string): string {
  const c = getData().countriesByIso.get(iso);
  return c ? countryPageHref(c, { eventId }) : '/countries/';
}

/** Найдовша серія поясів підряд (за порядком поясу), що закінчується останнім штампом. */
function streakOf(stamps: readonly Stamp[]): number {
  const data = getData();
  const orders = [...new Set(stamps.map((s) => data.zonesById.get(data.eventsById.get(s.eventId)?.zoneId ?? '')?.order).filter((x): x is number => x !== undefined))].sort((a, b) => a - b);
  if (orders.length === 0) return 0;
  let run = 1;
  for (let i = orders.length - 1; i > 0; i -= 1) {
    if (orders[i]! - orders[i - 1]! === 1) run += 1;
    else break;
  }
  return run;
}

export function NotificationsGenerator() {
  const clock = useClock();
  const now = useNow({ granularity: 'minute' });
  const push = useNotifStore((s) => s.push);
  const schedule = useGuestStore((s) => s.schedule);
  const mountedAt = useRef(0);

  // Штампи, досягнення, серія.
  useEffect(() => {
    const data = getData();
    const seen = new Set(useGuestStore.getState().stamps.map((s) => s.eventId));
    return useGuestStore.subscribe((state, prev) => {
      if (state.stamps === prev.stamps) return;
      const at = clock.getSnapshot() || Date.now();
      for (const st of state.stamps) {
        if (seen.has(st.eventId)) continue;
        seen.add(st.eventId);
        const country = data.countriesByIso.get(st.countryIso);
        push({ id: `stamp:${st.eventId}`, kind: 'stamp', params: { country: country?.name.uk ?? st.cityName, city: st.cityName }, href: '/passport/', flag: st.countryIso, createdAt: at });
      }
      const countries = new Set(state.stamps.map((s) => s.countryIso)).size;
      const zones = new Set(state.stamps.map((s) => data.eventsById.get(s.eventId)?.zoneId).filter(Boolean)).size;
      for (const g of COUNTRY_GOALS) if (countries >= g) push({ id: `goal:countries:${g}`, kind: 'goal', params: { count: g, what: 'countries' }, href: '/passport/', createdAt: at });
      for (const g of ZONE_GOALS) if (zones >= g) push({ id: `goal:zones:${g}`, kind: 'goal', params: { count: g, what: 'zones' }, href: '/passport/', createdAt: at });
      const run = streakOf(state.stamps);
      for (const g of STREAK_GOALS) if (run >= g) push({ id: `streak:${g}`, kind: 'streak', params: { count: g }, href: '/passport/', createdAt: at });
    });
  }, [clock, push]);

  // Трансляції з графіка — за часом (машина часу теж рахується).
  useEffect(() => {
    if (!now) return;
    const data = getData();
    for (const id of schedule) {
      const e = data.eventsById.get(id);
      if (!e) continue;
      if (now >= e.midnightMs - HOWTO_BEFORE && now < e.midnightMs + HOWTO_BEFORE) {
        const city = data.citiesById.get(e.cityId)?.name.uk ?? '';
        const country = data.countriesByIso.get(e.countryIso)?.name.uk ?? '';
        push({ id: `live:${id}`, kind: 'live', params: { city, country, time: formatClock(e.midnightMs) }, href: countryHref(e.countryIso, e.id), flag: e.countryIso, createdAt: now });
      }
    }
  }, [now, schedule, push]);

  // Відповіді в чаті — лише нові (після відкриття сайту).
  useEffect(() => {
    mountedAt.current = clock.getSnapshot() || Date.now();
    const seen = new Set<string>();
    // Дивимось лише нове в кожній кімнаті (стрічка росте швидко — повний перебір гальмує чат).
    const lengths = new Map<string, number>(Object.entries(useChatFeed.getState().rooms).map(([room, list]) => [room, list?.length ?? 0]));
    return useChatFeed.subscribe((state, prev) => {
      if (state.rooms === prev.rooms) return;
      const nick = useGuestStore.getState().nick;
      for (const [room, list] of Object.entries(state.rooms)) {
        if (!list || list === prev.rooms[room as keyof typeof prev.rooms]) continue;
        const from = Math.min(lengths.get(room) ?? 0, list.length);
        lengths.set(room, list.length);
        // Стрічку обрізали чи замінили — переглядаємо лише хвіст.
        const start = from > 0 && from <= list.length ? from : Math.max(0, list.length - 20);
        if (!nick) continue;
        for (let i = start; i < list.length; i += 1) {
          const m = list[i]!;
          if (seen.has(m.id) || m.author?.isMine || m.replyTo?.nick !== nick || m.createdAt < mountedAt.current - 60_000) continue;
          seen.add(m.id);
          push({
            id: `reply:${m.id}`,
            kind: 'reply',
            params: { nick: m.author?.nick ?? '', text: (m.text ?? '').slice(0, 90) },
            href: '/',
            flag: m.author?.flagCode,
            createdAt: m.createdAt,
          });
        }
      }
    });
  }, [clock, push]);

  return null;
}
