/**
 * Сповіщення (дошка `Desk-Notif-New`, рішення власника 2026-11-09). Типи: трансляція з графіка почалась, штамп у паспорті,
 * відповідь у чаті, досягнення паспорта (країни, пояси), «Перший ряд» (твоє місце скоро на стіні), серія за свято.
 * Список на пристрої (нові зверху, прочитані — нижче); налаштування — «усі» і кожен тип окремо. Створює їх
 * `NotificationsWatcher`; показує вікно O-NOTIF (`NotificationsBody`).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { safeJsonStorage } from '@/lib/storage/safe';

export const NOTIF_STORAGE_KEY = 't2f:notif:v1';
export const NOTIF_KINDS = ['live', 'stamp', 'reply', 'goal', 'seat', 'streak'] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

export interface Notif {
  /** Стабільний ключ (`stamp:<eventId>` тощо) — одне сповіщення на подію. */
  id: string;
  kind: NotifKind;
  createdAt: number;
  read: boolean;
  /** Параметри тексту (`notif.items.<kind>`). */
  params: Record<string, string | number>;
  /** Куди веде дія. */
  href: string;
  /** Прапор на значку (ISO). */
  flag?: string;
}

interface NotifState {
  items: Notif[];
  enabled: boolean;
  kinds: Record<NotifKind, boolean>;
  push(n: Omit<Notif, 'read' | 'createdAt'> & { createdAt?: number }): void;
  markRead(id: string): void;
  markAllRead(): void;
  clear(): void;
  setEnabled(v: boolean): void;
  setKind(kind: NotifKind, v: boolean): void;
}

const ALL_ON = Object.fromEntries(NOTIF_KINDS.map((k) => [k, true])) as Record<NotifKind, boolean>;
/** Скільки пам’ятати. */
const MAX_ITEMS = 60;

export const useNotifStore = create<NotifState>()(
  persist(
    (set, get) => ({
      items: [],
      enabled: true,
      kinds: { ...ALL_ON },
      push: (n) => {
        const s = get();
        if (!s.enabled || !s.kinds[n.kind] || s.items.some((x) => x.id === n.id)) return;
        set({ items: [{ ...n, createdAt: n.createdAt ?? Date.now(), read: false }, ...s.items].slice(0, MAX_ITEMS) });
      },
      markRead: (id) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
      markAllRead: () => set((s) => ({ items: s.items.map((x) => ({ ...x, read: true })) })),
      clear: () => set({ items: [] }),
      setEnabled: (enabled) => set({ enabled }),
      setKind: (kind, v) => set((s) => ({ kinds: { ...s.kinds, [kind]: v } })),
    }),
    {
      name: NOTIF_STORAGE_KEY,
      version: 1,
      storage: safeJsonStorage<Pick<NotifState, 'items' | 'enabled' | 'kinds'>>('local'),
      partialize: (s) => ({ items: s.items, enabled: s.enabled, kinds: s.kinds }),
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<NotifState>;
        return { ...current, ...p, kinds: { ...ALL_ON, ...(p.kinds ?? {}) }, items: Array.isArray(p.items) ? p.items : [] };
      },
    },
  ),
);

export function useUnreadCount(): number {
  return useNotifStore((s) => s.items.reduce((n, x) => n + (x.read ? 0 : 1), 0));
}
