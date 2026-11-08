/**
 * Перемикачі прихованої панелі тестової збірки (contracts/time-machine.md):
 * результат імітованої оплати, «Чат недоступний», «Немає з’єднання», «Повільний режим», «Порожня кімната «Країна»», вхід (недоступний, Google скасовано), лічильник сповіщень.
 * Не зберігаються; у робочій збірці лишаються значеннями за замовчуванням.
 */
import { create } from 'zustand';
import type { PayResult } from '@/lib/data/types';

export interface TestControlsState {
  payResult: PayResult;
  chatAvailable: boolean;
  offlineSimulated: boolean;
  /** Повільний режим у всіх кімнатах (секунди; 0 — лише за сценарієм `chat-script.json`). */
  slowForcedSec: number;
  /** Кімнати «Країна» без чужих повідомлень — видно стан «Тут поки тихо». */
  emptyCountry: boolean;
  /** Сервіс входу не відповідає — «Вхід тимчасово недоступний». */
  authUnavailable: boolean;
  /** Імітований Google повертає «скасовано». */
  googleCancelled: boolean;
  /** Нових сповіщень — лічильник на дзвіночку шапки (поки сповіщень немає, задається тут). */
  notifications: number;
  setPayResult(r: PayResult): void;
  setChatAvailable(ok: boolean): void;
  setOfflineSimulated(v: boolean): void;
  setSlowForcedSec(sec: number): void;
  setEmptyCountry(v: boolean): void;
  setAuthUnavailable(v: boolean): void;
  setGoogleCancelled(v: boolean): void;
  setNotifications(n: number): void;
}

export const useTestControls = create<TestControlsState>()((set) => ({
  payResult: 'success',
  chatAvailable: true,
  offlineSimulated: false,
  slowForcedSec: 0,
  emptyCountry: false,
  authUnavailable: false,
  googleCancelled: false,
  notifications: 0,
  setPayResult: (payResult) => set({ payResult }),
  setChatAvailable: (chatAvailable) => set({ chatAvailable }),
  setOfflineSimulated: (offlineSimulated) => set({ offlineSimulated }),
  setSlowForcedSec: (slowForcedSec) => set({ slowForcedSec }),
  setEmptyCountry: (emptyCountry) => set({ emptyCountry }),
  setAuthUnavailable: (authUnavailable) => set({ authUnavailable }),
  setGoogleCancelled: (googleCancelled) => set({ googleCancelled }),
  setNotifications: (notifications) => set({ notifications }),
}));
