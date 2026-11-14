/**
 * Тостер «Додано в графік» (рішення власника 2026-11-06, дошка `Desk-Schedule-New`): одна плашка за раз; нова дія замінює
 * текст і перезапускає відлік 6 с. «Повернути» ставить графік, який був до дії.
 */
import { create } from 'zustand';

/** Скільки висить тостер. */
export const SCHEDULE_TOAST_MS = 6000;

export interface ScheduleToastState {
  /** `failed` — сервер не зберіг графік: плашка-помилка без «Повернути» (стан для `http`). */
  toast: { id: number; text: string; prev: string[]; failed?: boolean } | null;
}

export const useScheduleToast = create<ScheduleToastState>(() => ({ toast: null }));

let seq = 0;

/** Показати тостер; `prev` — графік до дії (для «Повернути»). */
export function showScheduleToast(text: string, prev: readonly string[], opts: { failed?: boolean } = {}): void {
  seq += 1;
  useScheduleToast.setState({ toast: { id: seq, text, prev: [...prev], ...(opts.failed ? { failed: true } : {}) } });
}

export function hideScheduleToast(): void {
  useScheduleToast.setState({ toast: null });
}
