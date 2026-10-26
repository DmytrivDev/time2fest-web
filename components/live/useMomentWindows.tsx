'use client';

/**
 * Вікна моменту на поверхні ефіру (T081, `contracts/ui-events.md`):
 * - `moment:stamp` (+15 с) — штамп у `InFlowSlot` через `OverlayManager` (`inflow`), одне оголошення
 *   «<Місто>: північ. Ачівка готова — під плеєром» (запізніле — без оголошення й без удару штемпеля);
 * - `moment:rate-open` (+2 хв) — «Як тобі шоу?» на 3 хв разом із рядком «Штамп у паспорті»; закривається
 *   за `moment:rate-close` або сама (×, таймаут), поки людина не взаємодіє (WCAG 2.2.1);
 * - коли слот порожній, а штамп за поточну подію вже є — рядок «Штамп у паспорті» (згорнутий штамп);
 * - перехід ефіру (`air:handover`) прибирає вікна попередньої події.
 * Нічого не лежить поверх плеєра: усі вікна — `inflow`, під рядком дій.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import { Rate, type RateRow } from '@/components/windows/Rate';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { getData } from '@/lib/data/load';
import type { Stars } from '@/lib/data/types';
import { on } from '@/lib/events/bus';
import { setRateInteracting } from '@/lib/live/rateInteraction';
import { useGuestStore } from '@/stores/guest';

export const STAMP_WINDOW_ID = 'O-STAMP';
export const RATE_WINDOW_ID = 'O-RATE';

function stampEntry(eventId: string): StampEntry | null {
  const data = getData();
  const event = data.eventsById.get(eventId);
  if (!event) return null;
  const country = data.countriesByIso.get(event.countryIso);
  const city = data.citiesById.get(event.cityId);
  const seat = useGuestStore.getState().firstRow[eventId]?.seat;
  const entry: StampEntry = {
    eventId,
    city: city?.name.uk ?? '',
    countryName: country?.name.uk ?? '',
    flagCode: country?.flagCode ?? event.countryIso,
    illustrationId: country?.illustrationId ?? 'generic',
  };
  if (seat !== undefined) entry.firstRowSeat = seat;
  return entry;
}

function rateRow(eventId: string): RateRow | null {
  const e = stampEntry(eventId);
  return e ? { eventId, countryName: e.countryName, city: e.city, flagCode: e.flagCode } : null;
}

const entries = (ids: readonly string[]) => ids.map(stampEntry).filter((e): e is StampEntry => e !== null);

function RateWindow({ eventIds, closesAt, onDone }: { eventIds: string[]; closesAt: number; onDone: () => void }) {
  const ratings = useGuestStore((s) => s.rate);
  const setRate = useGuestStore((s) => s.setRate);
  const rows = eventIds.map(rateRow).filter((r): r is RateRow => r !== null);
  const values: Partial<Record<string, Stars>> = {};
  for (const id of eventIds) {
    const stars = ratings[id]?.stars;
    if (stars !== undefined) values[id] = stars;
  }
  useEffect(() => () => setRateInteracting(false), []);
  return (
    <div className="flex flex-col gap-2">
      <Stamp stamps={entries(eventIds)} defaultMode="collapsed" />
      <Rate
        rows={rows}
        ratings={values}
        closesAt={closesAt}
        onRate={(id, stars) => setRate(id, { stars })}
        onInteractionChange={setRateInteracting}
        onClose={() => onDone()}
      />
    </div>
  );
}

/**
 * @param currentEventId подія, яку зараз показує ефір (для рядка «Штамп у паспорті» після оцінки).
 */
export function useMomentWindows(currentEventId: string | null): void {
  const overlay = useOverlay();
  const announce = useAnnounce();
  const tA11y = useTranslations('a11y');
  const tWin = useTranslations('windows');
  const { open, close, current } = overlay;
  const dismissed = useRef(new Set<string>());

  const closeRate = useCallback((eventIds: readonly string[]) => {
    const { setRate } = useGuestStore.getState();
    for (const id of eventIds) setRate(id, { closed: true });
    setRateInteracting(false);
  }, []);

  const openStamp = useCallback(
    (eventIds: string[], opts: { collapsed: boolean; stamping: boolean }) => {
      const list = entries(eventIds);
      if (!list.length) return;
      const key = eventIds.join('|');
      open({
        id: STAMP_WINDOW_ID,
        kind: 'inflow',
        title: tWin('achievement.heading'),
        closeOn: ['air:handover'],
        content: (
          <Stamp
            key={`${key}:${opts.collapsed ? 'c' : 'e'}`}
            stamps={list}
            defaultMode={opts.collapsed ? 'collapsed' : 'expanded'}
            stamping={opts.stamping}
            onClose={
              opts.collapsed
                ? () => {
                    for (const id of eventIds) dismissed.current.add(id);
                    close(STAMP_WINDOW_ID);
                  }
                : undefined
            }
          />
        ),
      });
    },
    [open, close, tWin],
  );

  // +15 с: штамп + оголошення.
  useEffect(
    () =>
      on('moment:stamp', (p) => {
        if (!p.presentEventIds.length) return;
        openStamp(p.presentEventIds, { collapsed: false, stamping: !p.late });
        const city = getData().citiesById.get(p.announce.cityId)?.name.uk;
        if (city) announce(tA11y('midnightMoment', { place: city }), { late: p.late });
      }),
    [openStamp, announce, tA11y],
  );

  // +2 хв: оцінка на 3 хв.
  useEffect(
    () =>
      on('moment:rate-open', (p) => {
        const ids = [...p.eventIds];
        open({
          id: RATE_WINDOW_ID,
          kind: 'inflow',
          title: tWin('rate.title'),
          closeOn: ['moment:rate-close', 'air:handover'],
          onClose: () => closeRate(ids),
          content: <RateWindow eventIds={ids} closesAt={p.closesAt} onDone={() => close(RATE_WINDOW_ID)} />,
        });
      }),
    [open, close, closeRate, tWin],
  );

  // Слот порожній, а штамп за поточну подію вже є → рядок «Штамп у паспорті».
  const hasStamp = useGuestStore((s) => (currentEventId ? s.stamps.some((x) => x.eventId === currentEventId) : false));
  const rateOpen = useGuestStore((s) => (currentEventId ? s.rate[currentEventId]?.closed === false : false));
  useEffect(() => {
    if (current || !currentEventId || !hasStamp || rateOpen) return;
    if (dismissed.current.has(currentEventId)) return;
    openStamp([currentEventId], { collapsed: true, stamping: false });
  }, [current, currentEventId, hasStamp, rateOpen, openStamp]);

}
