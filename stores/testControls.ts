/**
 * Перемикачі прихованої панелі тестової збірки (contracts/time-machine.md):
 * результат імітованої оплати, «Чат недоступний», «Немає з’єднання».
 * Не зберігаються; у робочій збірці лишаються значеннями за замовчуванням.
 */
import { create } from 'zustand';
import type { PayResult } from '@/lib/data/types';

export interface TestControlsState {
  payResult: PayResult;
  chatAvailable: boolean;
  offlineSimulated: boolean;
  setPayResult(r: PayResult): void;
  setChatAvailable(ok: boolean): void;
  setOfflineSimulated(v: boolean): void;
}

export const useTestControls = create<TestControlsState>()((set) => ({
  payResult: 'success',
  chatAvailable: true,
  offlineSimulated: false,
  setPayResult: (payResult) => set({ payResult }),
  setChatAvailable: (chatAvailable) => set({ chatAvailable }),
  setOfflineSimulated: (offlineSimulated) => set({ offlineSimulated }),
}));
