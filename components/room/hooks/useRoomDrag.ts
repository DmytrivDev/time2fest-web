/**
 * Перетягування вікон кімнати за смугу (десктоп, власник 2026-11-05). Над відео нічого не рухається (правила YouTube
 * забороняють будь-які елементи перед плеєром, навіть тимчасово): вказівник захоплює смуга (`setPointerCapture`, тож
 * події не губляться над iframe), ціль визначаємо `elementFromPoint`, а вікна лише змінюють смуги й рамки.
 * Відпустив над іншим вікном або вільним місцем — `onDrop(slot, pos)` (міняються місцями / переходить туди). Esc — скасувати.
 */
import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';

const THRESHOLD_PX = 6;

export interface RoomDrag {
  dragSlot: number | null;
  /** Місце в сітці під курсором (вікно або вільне місце). */
  overPos: number | null;
  onBarPointerDown(e: PointerEvent<HTMLDivElement>, slot: number): void;
}

function posAt(x: number, y: number, from: number): number | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-room-pos]');
  if (!el || el.dataset.roomWindow === String(from)) return null;
  const v = el.dataset.roomPos;
  return v === undefined ? null : Number(v);
}

export function useRoomDrag(onDrop: (slot: number, pos: number) => void): RoomDrag {
  const [dragSlot, setDragSlot] = useState<number | null>(null);
  const [overPos, setOverPos] = useState<number | null>(null);
  const state = useRef<{
    slot: number;
    x: number;
    y: number;
    active: boolean;
    over: number | null;
  } | null>(null);

  const reset = useCallback(() => {
    state.current = null;
    setDragSlot(null);
    setOverPos(null);
  }, []);

  useEffect(() => {
    if (dragSlot === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') reset();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dragSlot, reset]);

  const onBarPointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>, slot: number) => {
      if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
      const el = e.currentTarget;
      el.setPointerCapture(e.pointerId);
      state.current = { slot, x: e.clientX, y: e.clientY, active: false, over: null };
      const move = (ev: globalThis.PointerEvent) => {
        const st = state.current;
        if (!st) return;
        if (!st.active) {
          if (Math.hypot(ev.clientX - st.x, ev.clientY - st.y) < THRESHOLD_PX) return;
          st.active = true;
          setDragSlot(st.slot);
        }
        st.over = posAt(ev.clientX, ev.clientY, st.slot);
        setOverPos(st.over);
      };
      const up = () => {
        const st = state.current;
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
        if (st?.active && st.over !== null) onDrop(st.slot, st.over);
        reset();
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    },
    [onDrop, reset],
  );

  return { dragSlot, overPos, onBarPointerDown };
}
