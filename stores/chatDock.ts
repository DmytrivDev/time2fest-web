/**
 * Телефонне вікно чату, закріплене внизу (рішення 2026-10-27): розгорнуте чи згорнуте. Не зберігається: після
 * перезавантаження чат згорнутий. Лічильник «N нових» при згортанні веде `stores/chat` (`hiddenAt`).
 */
import { create } from 'zustand';

export interface ChatDockState {
  expanded: boolean;
  setExpanded(value: boolean): void;
}

export const useChatDock = create<ChatDockState>()((set) => ({
  expanded: false,
  setExpanded: (expanded) => set({ expanded }),
}));
