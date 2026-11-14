/**
 * Присутність, країни вікон і кімнати чату: яку країну показує чат (головного вікна або обрану в чаті) і які кімнати
 * чату підписані. Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useMemo, useState } from 'react';
import { useMomentWindows } from '@/components/live/useMomentWindows';
import { useChatRooms } from '@/lib/api/hooks/chat';
import { usePresence } from '@/lib/api/hooks/passport';
import type { Dataset, GuestRoomWindow, RoomId } from '@/lib/data/types';

export function useRoomChatCountries({
  windows,
  main,
  data,
}: {
  windows: readonly GuestRoomWindow[];
  main: GuestRoomWindow | null;
  data: Dataset;
}) {
  // ── Присутність, штамп, чат ──
  const eventIds = [...new Set(windows.map((w) => w.eventId))];
  usePresence(eventIds.length ? { source: 'room', eventIds } : null);
  useMomentWindows();
  const mainEvent = main ? data.eventsById.get(main.eventId) : undefined;
  const windowCountries = (() => {
    const out: { iso: string; name: string }[] = [];
    for (const w of windows) {
      const iso = data.eventsById.get(w.eventId)?.countryIso;
      const c = iso ? data.countriesByIso.get(iso) : undefined;
      if (c && !out.some((x) => x.iso === c.iso)) out.push({ iso: c.iso, name: c.name.uk });
    }
    return out;
  })();
  const [pickedIso, setPickedIso] = useState<string | null>(null);
  const mainCountry = mainEvent ? data.countriesByIso.get(mainEvent.countryIso) : undefined;
  const country =
    (pickedIso
      ? windowCountries.find((c) => c.iso === pickedIso) && data.countriesByIso.get(pickedIso)
      : undefined) ?? mainCountry;
  const chatRoomCountry: RoomId | null = country ? `country:${country.iso}` : null;
  const simRooms = windowCountries.map((c) => `country:${c.iso}`).join('|');
  useChatRooms(
    useMemo(
      () =>
        [
          'world',
          ...(simRooms ? simRooms.split('|') : chatRoomCountry ? [chatRoomCountry] : []),
        ] as RoomId[],
      [simRooms, chatRoomCountry],
    ),
  );

  return { eventIds, mainEvent, windowCountries, country, chatRoomCountry, setPickedIso };
}
