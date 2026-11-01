'use client';

/**
 * Вікна моменту на поверхні ефіру (T081, `contracts/ui-events.md`):
 * - `moment:stamp` (+15 с) — штамп в окремому блоці під рядком дій (`StampBlock`, не вікно — вікна збоку його не
 *   прибирають), одне оголошення «<Місто>: північ. Ачівка готова — під плеєром» (запізніле — без оголошення й без удару);
 * - `moment:rate-open` (+5 хв) — «Як тобі шоу?» рядком у штампі (`StampRate` у `StampBlock`); окрема картка на 3 хв
 *   у `InFlowSlot` — лише якщо штамп прибрали «×»; закривається за `moment:rate-close` або сама (×, таймаут), поки
 *   людина не взаємодіє (WCAG 2.2.1);
 * - перехід ефіру (`air:handover`) прибирає вікна попередньої події.
 * Нічого не лежить поверх плеєра: усі вікна — `inflow`, під рядком дій.
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect } from 'react';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import { Rate, type RateRow } from '@/components/windows/Rate';
import { getData } from '@/lib/data/load';
import type { Stars } from '@/lib/data/types';
import { on } from '@/lib/events/bus';
import { setRateInteracting } from '@/lib/live/rateInteraction';
import { showStampMoment, stampEntry } from './StampBlock';
import { useGuestStore } from '@/stores/guest';

export const RATE_WINDOW_ID = 'O-RATE';

function rateRow(eventId: string): RateRow | null {
  const e = stampEntry(eventId);
  return e ? { eventId, countryName: e.countryName, city: e.city, flagCode: e.flagCode } : null;
}

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
    <Rate
      rows={rows}
      ratings={values}
      closesAt={closesAt}
      onRate={(id, stars) => setRate(id, { stars })}
      onInteractionChange={setRateInteracting}
      onClose={() => onDone()}
    />
  );
}

export function useMomentWindows(): void {
  const overlay = useOverlay();
  const announce = useAnnounce();
  const tA11y = useTranslations('a11y');
  const tWin = useTranslations('windows');
  const { open, close } = overlay;

  const closeRate = useCallback((eventIds: readonly string[]) => {
    const { setRate } = useGuestStore.getState();
    for (const id of eventIds) setRate(id, { closed: true });
    setRateInteracting(false);
  }, []);

  // +15 с: штамп + оголошення.
  useEffect(
    () =>
      on('moment:stamp', (p) => {
        if (!p.presentEventIds.length) return;
        showStampMoment(p.presentEventIds, !p.late);
        const city = getData().citiesById.get(p.announce.cityId)?.name.uk;
        if (city) announce(tA11y('midnightMoment', { place: city }), { late: p.late });
      }),
    [announce, tA11y],
  );

  // +2 хв: оцінка на 3 хв.
  useEffect(
    () =>
      on('moment:rate-open', (p) => {
        const ids = [...p.eventIds];
        // Оцінка — рядком у штампі під плеєром (`StampBlock`); окрема картка — лише якщо штамп прибрали «×».
        const dismissed = useGuestStore.getState().stampsDismissed ?? [];
        if (!ids.every((id) => dismissed.includes(id))) return;
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
}
