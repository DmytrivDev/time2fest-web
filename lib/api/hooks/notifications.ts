'use client';

/**
 * Хуки домену «Сповіщення» — єдине, що бачать компоненти (`docs/backend/frontend-seam.md`).
 * Хук → `getService('notifications')` → адаптер `sim` чи `http`. Список і налаштування — два ресурси кешу
 * (`lib/api/resource`): завантажуються раз, далі живуть realtime-подіями. Дії оптимістичні: кеш змінюється одразу
 * (без стрибків інтерфейсу), сервіс підтверджує; на відмову — перечитуємо з сервісу (правда — у сервера).
 */
import { useMemo } from 'react';
import {
  applyNotifEvent,
  applyNotifSettingsPatch,
  DEFAULT_NOTIF_SETTINGS,
  type Notif,
  type NotifKind,
  type NotifReadTarget,
  type NotifSettings,
  type NotifSettingsPatch,
} from '../contracts/notifications';
import type { ApiError } from '../result';
import { createResource, useResource, type ResourceStatus } from '../resource';
import { getService } from '../services';

const EMPTY: readonly Notif[] = [];

export const notifInbox = createResource<readonly Notif[], Parameters<typeof applyNotifEvent>[1]>(() => {
  const svc = getService('notifications');
  return { load: () => svc.list(), subscribe: (cb) => svc.subscribe(cb), reduce: applyNotifEvent };
});

export const notifSettings = createResource<NotifSettings, Parameters<typeof applyNotifEvent>[1]>(() => {
  const svc = getService('notifications');
  return {
    load: () => svc.getSettings(),
    subscribe: (cb) => svc.subscribe(cb),
    reduce: (s, e) => (e.type === 'settings' ? e.settings : s),
  };
});

export interface NotificationsView {
  status: ResourceStatus;
  /** Нові зверху; до завантаження — порожньо (дивись `status`). */
  items: readonly Notif[];
  error: ApiError | null;
}

export function useNotifications(): NotificationsView {
  const st = useResource(notifInbox);
  return { status: st.status, items: st.data ?? EMPTY, error: st.error };
}

/** Скільки непрочитаних (дзвіночок у шапці). */
export function useUnreadNotifCount(): number {
  const { items } = useNotifications();
  return useMemo(() => items.reduce((n, x) => n + (x.read ? 0 : 1), 0), [items]);
}

export interface NotifSettingsView {
  status: ResourceStatus;
  /** До завантаження — типові (усе ввімкнено), як і в новому сховищі. */
  settings: NotifSettings;
}

export function useNotifSettings(): NotifSettingsView {
  const st = useResource(notifSettings);
  return { status: st.status, settings: st.data ?? DEFAULT_NOTIF_SETTINGS };
}

async function markRead(target: NotifReadTarget): Promise<void> {
  notifInbox.mutate((items) => applyNotifEvent(items, { type: 'read', target }));
  const res = await getService('notifications').markRead(target);
  if (!res.ok) await notifInbox.refresh();
}

async function updateSettings(patch: NotifSettingsPatch): Promise<void> {
  notifSettings.mutate((s) => applyNotifSettingsPatch(s, patch));
  const res = await getService('notifications').updateSettings(patch);
  if (!res.ok) await notifSettings.refresh();
}

/** Дії зі сповіщеннями (сталі функції — можна передавати в обробники без `useCallback`). */
export const notifActions = {
  /** «Спробувати ще» після помилки завантаження. */
  reload: () => notifInbox.refresh(),
  markRead: (id: string) => markRead({ ids: [id] }),
  markAllRead: () => markRead('all'),
  setEnabled: (enabled: boolean) => updateSettings({ enabled }),
  setKind: (kind: NotifKind, on: boolean) => updateSettings({ kinds: { [kind]: on } }),
} as const;
