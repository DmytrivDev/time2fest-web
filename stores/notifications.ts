/**
 * Сповіщення (дошка `Desk-Notif-New`, рішення власника 2026-11-09). Типи: трансляція з графіка почалась, штамп у паспорті,
 * відповідь у чаті, досягнення паспорта (країни, пояси), серія за свято. Тип `seat` («Перший ряд») прибрано разом із
 * рядом (рішення 2026-11-12): старі такі сповіщення й перемикач зі сховища відкидаються (`merge`).
 * Список на пристрої (нові зверху, прочитані — нижче); налаштування — «усі» і кожен тип окремо.
 * Шов (`docs/backend/frontend-seam.md`): цей стор — «сервер» імітації. Створює сповіщення
 * `lib/api/sim/NotificationsGenerator`; інтерфейс читає його лише через `lib/api/hooks/notifications` →
 * `lib/api/sim/notifications` (компонентам імпортувати стор заборонено правилом eslint).
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { NOTIF_KINDS, type Notif, type NotifKind } from '@/lib/api/contracts/notifications';
import { safeJsonStorage } from '@/lib/storage/safe';

export const NOTIF_STORAGE_KEY = 't2f:notif:v1';
// Типи — з контракту шва; реекспорт для імітації (тестова панель, демо, скидання пристрою).
export { NOTIF_KINDS, type Notif, type NotifKind };

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
        const known = (k: unknown): k is NotifKind => (NOTIF_KINDS as readonly unknown[]).includes(k);
        const kinds = { ...ALL_ON };
        for (const [k, v] of Object.entries(p.kinds ?? {})) if (known(k)) kinds[k] = v;
        const items = Array.isArray(p.items) ? p.items.filter((x) => known(x?.kind)) : [];
        return { ...current, ...p, kinds, items };
      },
    },
  ),
);
