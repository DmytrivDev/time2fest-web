'use client';

/**
 * Сітка вікон кімнати: картки вікон (DOM — за сталим номером, позиція — CSS `order`), плитка «Повернути» й вільні
 * місця. 1 вікно — на всю ширину, 2–4 — сітка 2×2, телефон — одне під одним. Виокремлено з `RoomLive.tsx` (WP-F).
 */
import { useTranslations } from 'next-intl';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { cn } from '@/components/primitives/cn';
import type { useOfferWindows } from '@/components/offers/useOfferWindows';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import { streamRows } from '@/lib/live/countryData';
import type { useOptionalPlayer } from '@/lib/player/PlayerProvider';
import type { RoomTarget } from '@/stores/room';
import { MainWaiting } from './MainWaiting';
import { SlotTile, UndoTile, type SlotState } from './RoomSlots';
import { RoomEndedCard } from './RoomEndedCard';
import { RoomWindowCard, type RoomWindowCardView } from './RoomWindowCard';
import { RoomWindowPlayer } from './RoomWindowPlayer';
import { flagOf } from '@/components/room/roomShare';
import type { RoomDrag } from '@/components/room/hooks/useRoomDrag';
import s from '@/components/room/room.module.css';

export interface RoomUndo {
  win: GuestRoomWindow;
  pos: number;
  sound: boolean;
  title: string;
  until: number;
}

export interface RoomBarNotice {
  slot: number;
  prev: RoomTarget;
  text: string;
  until: number;
}

export function RoomWindowsGrid({
  data,
  known,
  now,
  minute,
  phone,
  windows,
  player,
  schedule,
  stamps,
  started,
  soundSlot,
  soundLive,
  isHost,
  titleOf,
  undo,
  barNotice,
  drag,
  foldSlot,
  slotState,
  passWindows,
  onStart,
  onUnfold,
  onUndo,
  onUndoReplace,
  onRemove,
  onSound,
  onAdd,
  endedSlots,
  onAddOther,
}: {
  data: Dataset;
  known: boolean;
  now: number;
  minute: number;
  phone: boolean;
  windows: readonly GuestRoomWindow[];
  player: ReturnType<typeof useOptionalPlayer>;
  schedule: readonly string[];
  stamps: readonly { eventId: string }[];
  started: readonly number[];
  soundSlot: number | null;
  soundLive: boolean;
  isHost: (w: GuestRoomWindow) => boolean;
  titleOf: (w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>) => string;
  undo: RoomUndo | null;
  barNotice: RoomBarNotice | null;
  drag: RoomDrag;
  foldSlot: number | null;
  slotState: SlotState;
  passWindows: ReturnType<typeof useOfferWindows>;
  onStart: (slot: number) => void;
  onUnfold: () => void;
  onUndo: () => void;
  onUndoReplace: () => void;
  onRemove: (slot: number) => void;
  onSound: (slot: number) => void;
  onAdd: () => void;
  /** Вікна, чия трансляція завершилась (слот → кнопка «Додати іншу»). */
  endedSlots?: ReadonlySet<number>;
  onAddOther?: (slot: number) => void;
}) {
  const tUndo = useTranslations('room.undo');

  const views: (RoomWindowCardView & { w: GuestRoomWindow; order: number })[] = windows.map(
    (w, index) => {
      // Десктоп — стале місце в сітці (прибране вікно лишає порожнє місце); телефон — одне під одним.
      const order = phone ? index : (w.pos ?? index);
      const ev = data.eventsById.get(w.eventId);
      const row =
        ev && known ? streamRows(data, [ev], minute).find((r) => r.id === w.sourceId) : undefined;
      const sel = isHost(w) && player?.eventId === w.eventId ? player.selection : null;
      const title =
        sel && sel.kind !== 'countdown-scene'
          ? titleOf({ eventId: w.eventId, sourceId: sel.source.id })
          : titleOf(w);
      return {
        w,
        order,
        slot: w.slot,
        title,
        flagCode: flagOf(data, w.eventId),
        status: row?.status === 'recording' ? 'recording' : 'live',
        hasSound: windows.length > 1 && w.slot === soundSlot,
        audible: soundLive,
        inSchedule: schedule.includes(w.eventId),
        stamp: stamps.some((st) => st.eventId === w.eventId) ? 'got' : 'todo',
        endedCard: endedSlots?.has(w.slot) ? <RoomEndedCard title={title} onAddOther={() => onAddOther?.(w.slot)} /> : undefined,
      };
    },
  );
  // DOM — за сталим номером вікна (плеєри не переставляються), позиція — CSS `order`.
  const domOrder = [...views].sort((a, b) => a.slot - b.slot);

  const media = (w: GuestRoomWindow) =>
    isHost(w) ? (
      <PlayerSlot id="main" fallback={<MainWaiting />} />
    ) : (
      <RoomWindowPlayer
        slot={w.slot}
        eventId={w.eventId}
        sources={data.chainsByEventId.get(w.eventId)?.sources ?? []}
        preferredSourceId={w.sourceId}
        title={titleOf(w)}
        started={started.includes(w.slot)}
        hasSound={w.slot === soundSlot}
        soundAllowed
        onStart={onStart}
      />
    );

  // Плитка «Повернути» займає місце прибраного вікна (десктоп), тож сітка не перебудовується 6 с.
  const showUndoTile = !!undo && !phone;
  const single = !phone && windows.length === 1 && !showUndoTile;
  const taken = new Set([
    ...views.map((v) => v.order),
    ...(showUndoTile && undo ? [undo.pos] : []),
  ]);
  const slotPositions = phone
    ? windows.length === 0
      ? [0]
      : []
    : single
      ? []
      : [0, 1, 2, 3].filter((p) => !taken.has(p));

  return (
    <div
      data-room-grid=""
      data-room-layout={windows.length}
      data-dock-above=""
      data-video-column=""
      className={cn(s.grid, single && s.gridOne, phone && s.gridPhone)}
    >
      {domOrder.map((v) => (
        <RoomWindowCard
          key={v.slot}
          id={`room-w${v.slot}`}
          view={v}
          order={single ? 0 : v.order}
          pos={v.order}
          phone={phone}
          only={windows.length <= 1}
          media={media(v.w)}
          draggable={!phone && windows.length > 1}
          drag={drag.dragSlot === v.slot ? 'src' : drag.overPos === v.order ? 'dst' : null}
          notice={
            barNotice?.slot === v.slot
              ? { text: barNotice.text, undo: tUndo('undo'), onUndo: onUndoReplace }
              : null
          }
          folded={foldSlot === v.slot}
          onUnfold={onUnfold}
          onBarPointerDown={drag.onBarPointerDown}
          onRemove={onRemove}
          onSound={onSound}
        />
      ))}
      {showUndoTile && undo ? (
        <UndoTile title={undo.title} order={undo.pos} onUndo={onUndo} />
      ) : null}
      {slotPositions.map((p) => (
        <SlotTile
          key={`slot-${p}`}
          state={slotState}
          order={p}
          pos={p}
          dropTarget={drag.dragSlot !== null && drag.overPos === p}
          phone={phone}
          onAdd={onAdd}
          onSchedule={() =>
            passWindows.requestSchedule?.(
              data.events.find((e) => e.midnightMs > now)?.id ?? '',
              true,
            )
          }
        />
      ))}
    </div>
  );
}
