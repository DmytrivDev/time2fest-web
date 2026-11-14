/**
 * Відлік кімнати: найближча північ у вікнах, міста цієї півночі, таймер `гг:хх:сс` і міста, у яких ще можна отримати
 * штамп. Чиста функція (без React). Виокремлено з `RoomLive.tsx` (WP-F).
 */
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';

export function roomCountdown({
  windows,
  data,
  known,
  now,
  stamps,
}: {
  windows: readonly GuestRoomWindow[];
  data: Dataset;
  known: boolean;
  now: number;
  stamps: readonly { eventId: string }[];
}) {
  const midnights = windows
    .map((w) => ({ w, ev: data.eventsById.get(w.eventId) }))
    .filter((x): x is { w: GuestRoomWindow; ev: NonNullable<typeof x.ev> } => !!x.ev);
  const nextMidnight = known
    ? midnights
        .filter((x) => x.ev.midnightMs > now)
        .sort((a, b) => a.ev.midnightMs - b.ev.midnightMs)[0]?.ev.midnightMs
    : undefined;
  const nextCities = nextMidnight
    ? [
        ...new Set(
          midnights
            .filter((x) => x.ev.midnightMs === nextMidnight)
            .map((x) => data.citiesById.get(x.ev.cityId)?.name.uk ?? ''),
        ),
      ]
    : [];
  const left = nextMidnight ? Math.max(0, nextMidnight - now) : 0;
  const hh = String(Math.floor(left / 3_600_000)).padStart(2, '0');
  const mm = String(Math.floor((left % 3_600_000) / 60_000)).padStart(2, '0');
  const ss = String(Math.floor((left % 60_000) / 1000)).padStart(2, '0');
  const timerText = `${hh}:${mm}:${ss}`;
  const stampCities = [
    ...new Set(
      midnights
        .filter(
          (x) => known && x.ev.midnightMs > now && !stamps.some((st) => st.eventId === x.ev.id),
        )
        .map((x) => data.citiesById.get(x.ev.cityId)?.name.uk ?? ''),
    ),
  ];
  return { nextMidnight, nextCities, timerText, stampCities };
}
