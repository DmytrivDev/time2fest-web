'use client';

/**
 * Штамп під рядком дій плеєра — окремий блок, не вікно `OverlayManager` (рішення власника 2026-11-01): вікна збоку
 * («Обрати трансляцію», «Ще дії», «Поділитися», оцінка, пропозиції) його не прибирають.
 * - `moment:stamp` (+15 с) показує штамп подій цієї півночі з «ударом» печатки (`showStampMoment` у `useMomentWindows`);
 * - після перезавантаження — штамп поточної події ефіру, якщо він уже є, без удару;
 * - `air:handover` прибирає штамп попередньої події;
 * - поки під ним інше вікно (оцінка, пропозиція), «Поділитися» вторинна — коралова кнопка на екрані одна;
 * - «×» прибирає саме цей штамп (запис у `guest.stampsDismissed`), у паспорті він лишається.
 * Поява й зникнення — плавно (`Reveal`, як акордеони сайту).
 */
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';
import { Reveal } from '@/components/primitives/Reveal';
import { useOverlay } from '@/components/shell/OverlayManager';
import { shareWindowSpec } from '@/components/windows/Share';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { getData } from '@/lib/data/load';
import { on } from '@/lib/events/bus';
import { useGuestStore } from '@/stores/guest';
import { create } from 'zustand';

interface StampMoment {
  eventIds: string[];
  stamping: boolean;
}

const useStampMoment = create<{ moment: StampMoment | null }>(() => ({ moment: null }));

/** +15 с: показати штамп цих подій (з «ударом», якщо момент не запізнілий). */
export function showStampMoment(eventIds: readonly string[], stamping: boolean): void {
  const moment = { eventIds: [...eventIds], stamping };
  useStampMoment.setState({ moment });
  // Удар — один раз: блок, змонтований пізніше (інша сторінка), показує штамп уже на місці.
  if (stamping && typeof window !== 'undefined') {
    window.setTimeout(() => {
      if (useStampMoment.getState().moment === moment) useStampMoment.setState({ moment: { ...moment, stamping: false } });
    }, 3000);
  }
}

/** Тести й зміна ефіру. */
export function clearStampMoment(): void {
  useStampMoment.setState({ moment: null });
}

export function stampEntry(eventId: string): StampEntry | null {
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

export interface StampBlockProps {
  /** Подія, яку зараз показує плеєр сторінки. */
  eventId: string | null;
  className?: string;
}

export function StampBlock({ eventId, className }: StampBlockProps) {
  const tShare = useTranslations('share');
  const { open, current: win } = useOverlay();
  const moment = useStampMoment((s) => s.moment);
  const hasStamp = useGuestStore((s) => (eventId ? s.stamps.some((x) => x.eventId === eventId) : false));
  const dismissed = useGuestStore((s) => s.stampsDismissed);
  const dismissStamps = useGuestStore((s) => s.dismissStamps);

  useEffect(() => on('air:handover', () => clearStampMoment()), []);

  const ids = (moment?.eventIds ?? (eventId && hasStamp ? [eventId] : [])).filter((id) => !dismissed?.includes(id));
  const key = ids.join('|');
  const list = ids.map(stampEntry).filter((e): e is StampEntry => e !== null);
  const visible = list.length > 0;

  // Поки блок плавно згортається після «×», показуємо той самий штамп.
  const [shown, setShown] = useState<{ key: string; list: StampEntry[]; stamping: boolean } | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- запам’ятати останній показаний штамп для анімації зникнення
    if (visible) setShown({ key, list, stamping: !!moment?.stamping });
    // `list` похідний від `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, moment?.stamping]);
  const current = visible ? { key, list, stamping: !!moment?.stamping } : shown;

  return (
    <Reveal open={visible} className={className}>
      {current ? (
        <div className="pb-4" data-stamp-block="">
          <Stamp
            key={current.key}
            stamps={current.list}
            stamping={current.stamping}
            quiet={win?.kind === 'inflow'}
            onShare={() => open(shareWindowSpec(current.list, tShare('title')))}
            onClose={() => dismissStamps(current.list.map((e) => e.eventId!).filter(Boolean))}
          />
        </div>
      ) : null}
    </Reveal>
  );
}
