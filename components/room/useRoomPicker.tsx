'use client';

/**
 * Вибір трансляції в кімнаті: «Додати» (на місці чату / шторка), «+» на картці, «Що замінити?» для повної кімнати.
 * Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef } from 'react';
import { StreamPicker } from '@/components/live/StreamPicker';
import type { useOfferWindows } from '@/components/offers/useOfferWindows';
import { useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { useOverlay } from '@/components/shell/OverlayManager';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import { cityOf } from '@/lib/live/cityOf';
import type { StreamRowData } from '@/lib/live/countryData';
import { thumbOf } from '@/lib/live/thumb';
import { useGuestStore } from '@/stores/guest';
import { posOf, useRoomStore, type RoomTarget, type RoomViewport } from '@/stores/room';
import { RoomReplacePanel } from './RoomReplacePanel';
import { flagOf } from './roomShare';
import { REPLACE_ID } from './useRoomActions';
import { RoomPageContext } from './useRoomToggle';

const PICKER_ID = 'O-ROOM-ADD';

export function useRoomPicker({
  windows,
  soundSlot,
  soundLive,
  viewport,
  phone,
  limit,
  main,
  data,
  now,
  liveRows,
  passWindows,
  titleOf,
  remove,
  replaceInto,
}: {
  windows: readonly GuestRoomWindow[];
  soundSlot: number | null;
  soundLive: boolean;
  viewport: RoomViewport;
  phone: boolean;
  limit: number;
  main: GuestRoomWindow | null;
  data: Dataset;
  now: number;
  liveRows: readonly StreamRowData[];
  passWindows: ReturnType<typeof useOfferWindows>;
  titleOf: (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => string;
  remove: (slot: number) => void;
  replaceInto: (slot: number) => void;
}) {
  const t = useTranslations('room.page');
  const announce = useAnnounce();
  const overlay = useOverlay();
  const { pickTarget } = useRoomStore();

  const add = useCallback(
    (target: RoomTarget) => {
      const res = useRoomStore.getState().add(target, viewport);
      if (res === 'added') {
        overlay.close(PICKER_ID);
        announce(t('added', { city: cityOf(titleOf(target)) }));
      }
    },
    [viewport, overlay, announce, t, titleOf],
  );

  // «+» на картці: є — прибрати; немає — додати (повна → «Що замінити?»).
  const toggleFromCard = useCallback(
    (target: RoomTarget) => {
      const w = windows.find((x) => x.sourceId === target.sourceId);
      if (w) remove(w.slot);
      else add(target);
    },
    [windows, remove, add],
  );

  // ── Вибір трансляції (на місці чату / шторка) ──
  const openPicker = useCallback(() => {
    overlay.open({
      id: PICKER_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('addTitle'),
      description: t('addSub', { count: windows.length, limit }),
      // Вікно рендериться поза сторінкою (колонка чату / шторка) — контекст кімнати передаємо явно.
      content: (
        <RoomPageContext.Provider value={{ toggle: (target: RoomTarget) => add(target) }}>
          <StreamPicker
            midnightMs={main ? (data.eventsById.get(main.eventId)?.midnightMs ?? now) : now}
            rows={liveRows}
            onPick={(row) => add({ sourceId: row.id, eventId: row.eventId })}
            onAddToRoom={(row: StreamRowData) => add({ sourceId: row.id, eventId: row.eventId })}
            onToggleSchedule={(id) =>
              passWindows.requestSchedule(id, !useGuestStore.getState().schedule.includes(id))
            }
          />
        </RoomPageContext.Provider>
      ),
    });
  }, [overlay, t, windows.length, limit, main, data, now, liveRows, add, passWindows]);

  // Кімната повна → «Що замінити?» (одне місце для вибору).
  useEffect(() => {
    if (!pickTarget) {
      if (overlay.current?.id === REPLACE_ID) overlay.close(REPLACE_ID);
      return;
    }
    overlay.open({
      id: REPLACE_ID,
      kind: 'accent',
      chrome: 'board',
      title: t('replaceTitle'),
      description: phone ? t('replaceSubPhone') : t('replaceSub'),
      content: (
        <RoomReplacePanel
          phone={phone}
          adding={{
            title: titleOf(pickTarget),
            flagCode: flagOf(data, pickTarget.eventId),
            thumb: thumbOf({ id: pickTarget.sourceId, eventId: pickTarget.eventId }),
          }}
          windows={windows.map((w, i) => ({
            slot: w.slot,
            position: posOf(w, i) + 1,
            title: titleOf(w),
            flagCode: flagOf(data, w.eventId),
            thumb: thumbOf({ id: w.sourceId, eventId: w.eventId }),
            hasSound: w.slot === soundSlot && soundLive,
          }))}
          onPick={replaceInto}
          onCancel={() => useRoomStore.getState().cancelPick()}
        />
      ),
    });
    // вміст оновлюємо, коли змінюється, що замінюємо й чим
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickTarget, windows, soundSlot, soundLive, phone]);
  // Закрили вікно «Що замінити?» (×, інше вікно) — заміну скасовано.
  const overlayId = overlay.current?.id ?? null;
  const prevOverlayId = useRef<string | null>(null);
  useEffect(() => {
    const prev = prevOverlayId.current;
    prevOverlayId.current = overlayId;
    if (prev === REPLACE_ID && overlayId !== REPLACE_ID && useRoomStore.getState().pickTarget) {
      useRoomStore.getState().cancelPick();
    }
  }, [overlayId]);

  return { add, toggleFromCard, openPicker };
}
