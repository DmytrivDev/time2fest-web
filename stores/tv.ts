/**
 * Налаштування режиму вечірки (S-TV, рішення 2026-11-06): «Що показувати» — «Усе свято» (автопілот) чи «Мій графік»,
 * і чи гість уже бачив пояснення режиму (перший захід). Зберігається на пристрої.
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TvShow = 'all' | 'mine';

export interface TvPrefsState {
  show: TvShow;
  /** Пояснення режиму вже показали («Зрозуміло · OK»). */
  welcomed: boolean;
  setShow(show: TvShow): void;
  setWelcomed(welcomed: boolean): void;
}

export const useTvPrefs = create<TvPrefsState>()(
  persist(
    (set) => ({
      show: 'all',
      welcomed: false,
      setShow: (show) => set({ show }),
      setWelcomed: (welcomed) => set({ welcomed }),
    }),
    {
      name: 't2f:tv',
      version: 1,
      partialize: (s) => ({ show: s.show, welcomed: s.welcomed }),
    },
  ),
);
