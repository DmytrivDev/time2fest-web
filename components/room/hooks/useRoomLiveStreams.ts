'use client';

/**
 * Трансляції наживо для «Додати» й вільних місць кімнати.
 * Пояс кімнати — пояс головного вікна (порожня кімната — поточний пояс: найближча північ, що минула не більш як на
 * `HANDOVER_AFTER`). У списку «Додати» й у «Поточних трансляціях» — усі трансляції цього поясу, що йдуть зараз
 * (власник 2026-11-06). Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useMemo } from 'react';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import { HANDOVER_AFTER } from '@/lib/engine/config';
import { formatClock } from '@/lib/i18n/time';
import { streamRows, type StreamRowData } from '@/lib/live/countryData';
import type { SlotState } from '@/components/room/parts/RoomSlots';

export function useRoomLiveStreams({
  data,
  known,
  now,
  minute,
  main,
  roomWindows,
}: {
  data: Dataset;
  known: boolean;
  now: number;
  minute: number;
  main: GuestRoomWindow | null;
  roomWindows: readonly GuestRoomWindow[];
}) {
  const roomZoneId =
    (main ? data.eventsById.get(main.eventId)?.zoneId : undefined) ??
    (known ? data.zones.find((z) => now < z.midnightMs + HANDOVER_AFTER)?.id : undefined) ??
    null;
  const liveRows = useMemo(() => {
    if (!known || !roomZoneId) return [] as StreamRowData[];
    const evs = data.events.filter((e) => e.zoneId === roomZoneId);
    return streamRows(data, evs, minute).filter((r) => r.status === 'live');
  }, [data, known, minute, roomZoneId]);
  const inRoomIds = useMemo(() => new Set(roomWindows.map((w) => w.sourceId)), [roomWindows]);
  const freeLive = liveRows.filter((r) => !inRoomIds.has(r.id));

  const slotState: SlotState = useMemo(() => {
    if (freeLive.length > 1)
      return {
        kind: 'live',
        count: freeLive.length,
        flags: [...new Set(freeLive.map((r) => r.flagCode))],
      };
    if (freeLive.length === 1) return { kind: 'one', title: freeLive[0]!.title };
    const upcoming = known
      ? data.events
          .filter(
            (e) => e.midnightMs > now && (data.chainsByEventId.get(e.id)?.sources.length ?? 0) > 0,
          )
          .sort((a, b) => a.midnightMs - b.midnightMs)[0]
      : undefined;
    if (liveRows.length > 0)
      return { kind: 'all-in', next: upcoming ? formatClock(upcoming.midnightMs) : null };
    return {
      kind: 'none',
      next: upcoming
        ? {
            title: data.citiesById.get(upcoming.cityId)?.name.uk ?? '',
            time: formatClock(upcoming.midnightMs),
          }
        : null,
    };
  }, [freeLive, liveRows, known, data, now]);

  return { roomZoneId, liveRows, slotState };
}
