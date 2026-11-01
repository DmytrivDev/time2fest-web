'use client';

/**
 * Штамп під рядком дій плеєра — окремий блок, не вікно `OverlayManager` (рішення власника 2026-11-01): вікна збоку
 * («Обрати трансляцію», «Ще дії», «Поділитися», оцінка, пропозиції) його не прибирають.
 * - `moment:stamp` (+15 с) показує штамп подій цієї півночі з «ударом» печатки (`showStampMoment` у `useMomentWindows`);
 * - після перезавантаження — штамп поточної події ефіру, якщо він уже є, без удару;
 * - `air:handover` прибирає штамп попередньої події;
 * - поки під ним інше вікно (оцінка, пропозиція), «Поділитися» вторинна — коралова кнопка на екрані одна;
 * - «Як тобі шоу?» (`StampRate`) — під кнопками разом зі штампом (рішення 2026-11-01): «×» прибирає й оцінку, оцінити
 *   можна в паспорті;
 * - «Увійди» відкриває вхід на місці чату (трансляція не зупиняється), «Мій паспорт» — сторінка `/passport/`;
 * - поява — одразу, без анімації блока (правка власника 2026-11-01); удар печатки й конфеті — як були;
 * - «×» прибирає саме цей штамп (запис у `guest.stampsDismissed`), у паспорті він лишається: картка гасне й трохи
 *   відпливає вгору, потім порожнє місце стягується.
 */
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useOpenAuthWindow } from '@/components/auth/AuthWindow';
import { useHeaderUser } from '@/components/auth/session';
import { cn } from '@/components/primitives/cn';
import { Reveal } from '@/components/primitives/Reveal';
import { useOverlay } from '@/components/shell/OverlayManager';
import { shareWindowSpec } from '@/components/windows/Share';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { StampRate } from '@/components/windows/StampRate';
import { getData } from '@/lib/data/load';
import type { Stars } from '@/lib/data/types';
import { on } from '@/lib/events/bus';
import { useGuestStore } from '@/stores/guest';
import { create } from 'zustand';

interface StampMoment {
  eventIds: string[];
  stamping: boolean;
}

/** Сторінка «Мій паспорт Нових років». */
export const PASSPORT_HREF = '/passport/';
const LEAVE_MS = 220;
const reducedMotionOn = () => typeof document !== 'undefined' && document.documentElement.dataset.reduceMotion !== 'false';

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
  const openAuth = useOpenAuthWindow();
  const router = useRouter();
  const user = useHeaderUser();
  const moment = useStampMoment((s) => s.moment);
  const hasStamp = useGuestStore((s) => (eventId ? s.stamps.some((x) => x.eventId === eventId) : false));
  const dismissed = useGuestStore((s) => s.stampsDismissed);
  const dismissStamps = useGuestStore((s) => s.dismissStamps);
  const ratings = useGuestStore((s) => s.rate);
  const setRate = useGuestStore((s) => s.setRate);
  const guestId = useGuestStore((s) => s.id);
  // Під штампом — пропозиція пасу чи чайові (`OfferBlock`) зі своєю кораловою дією → «Поділитися» вторинна.
  const offerShown = useGuestStore((s) => {
    if (s.hasPass) return false;
    const last = s.offers.history.findLast((e) => e.kind === 'pass-offer' || e.kind === 'tips');
    return !!last && last.dismissedAt === undefined;
  });

  useEffect(() => on('air:handover', () => clearStampMoment()), []);
  // «Скинути стан гостя» (машина часу): показаний штамп належав попередньому гостю.
  const lastGuest = useRef(guestId);
  useEffect(() => {
    if (lastGuest.current !== guestId) clearStampMoment();
    lastGuest.current = guestId;
  }, [guestId]);

  const ids = (moment?.eventIds ?? (eventId && hasStamp ? [eventId] : [])).filter((id) => !dismissed?.includes(id));
  const key = ids.join('|');
  const list = ids.map(stampEntry).filter((e): e is StampEntry => e !== null);
  const visible = list.length > 0;

  // «×»: картка спершу гасне й трохи відпливає вгору (≈ 220 мс), потім порожнє місце плавно стягується. Позначку
  // «зникає» не знімаємо, поки місце стягується (інакше картка на мить повертається); знімаємо, коли штамп знову видно.
  const [leaving, setLeaving] = useState<string | null>(null);
  // Поки блок плавно зникає після «×», показуємо той самий штамп.
  const [shown, setShown] = useState<{ key: string; list: StampEntry[]; stamping: boolean } | null>(null);
  useEffect(() => {
    if (visible) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- запам’ятати останній показаний штамп для анімації зникнення
      setShown({ key, list, stamping: !!moment?.stamping });
      setLeaving(null);
    }
    // `list` похідний від `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, key, moment?.stamping]);
  const current = visible ? { key, list, stamping: !!moment?.stamping } : shown;

  const leaveTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(leaveTimer.current), []);
  const dismiss = (entries: StampEntry[], k: string) => {
    const ids = entries.map((e) => e.eventId!).filter(Boolean);
    if (reducedMotionOn()) return dismissStamps(ids);
    setLeaving(k);
    leaveTimer.current = window.setTimeout(() => {
      dismissStamps(ids);
    }, LEAVE_MS);
  };

  const values: Partial<Record<string, Stars>> = {};
  for (const e of current?.list ?? []) {
    const stars = e.eventId ? ratings[e.eventId]?.stars : undefined;
    if (stars !== undefined) values[e.eventId!] = stars;
  }

  return (
    <Reveal open={visible} className={cn('t2f-reveal-instant', className)}>
      {current ? (
        // `key` — новий штамп — новий блок (позначка «зникає» попереднього не переходить на нього).
        <div key={current.key} className="pb-4" data-stamp-block="" data-leaving={leaving === current.key || undefined}>
          <Stamp
            key={current.key}
            stamps={current.list}
            stamping={current.stamping}
            quiet={win?.kind === 'inflow' || offerShown}
            signedIn={!!user}
            onShare={() => open(shareWindowSpec(current.list, tShare('title')))}
            onSignIn={() => openAuth('signin')}
            onPassport={() => router.push(PASSPORT_HREF)}
            onClose={() => dismiss(current.list, current.key)}
            rate={
              <StampRate
                rows={current.list.map((e) => ({ eventId: e.eventId ?? '', city: e.city }))}
                values={values}
                onRate={(id, stars) => setRate(id, { stars })}
              />
            }
          />
        </div>
      ) : null}
    </Reveal>
  );
}
