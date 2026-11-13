/**
 * Адаптер `sim` домену «Сповіщення»: тонка обгортка над стором імітації `stores/notifications` (він — «сервер»).
 * Нуль нової поведінки: кожен метод делегує наявній дії стору; результат — одразу (`Promise` для однакового контракту).
 */
import { ok } from '../result';
import type { NotifEvent, NotificationsService, NotifSettings } from '../contracts/notifications';
import { NOTIF_KINDS, useNotifStore } from '@/stores/notifications';

type StoreState = ReturnType<typeof useNotifStore.getState>;

const settingsOf = (s: Pick<StoreState, 'enabled' | 'kinds'>): NotifSettings => ({ enabled: s.enabled, kinds: { ...s.kinds } });

export function createSimNotifications(): NotificationsService {
  return {
    async list() {
      return ok(useNotifStore.getState().items);
    },
    subscribe(onEvent: (event: NotifEvent) => void) {
      return useNotifStore.subscribe((state, prev) => {
        if (state.items !== prev.items) onEvent({ type: 'snapshot', items: state.items });
        if (state.enabled !== prev.enabled || state.kinds !== prev.kinds) onEvent({ type: 'settings', settings: settingsOf(state) });
      });
    },
    async markRead(target) {
      const st = useNotifStore.getState();
      if (target === 'all') st.markAllRead();
      else target.ids.forEach((id) => st.markRead(id));
      return ok(undefined);
    },
    async getSettings() {
      return ok(settingsOf(useNotifStore.getState()));
    },
    async updateSettings(patch) {
      const st = useNotifStore.getState();
      if (patch.enabled !== undefined) st.setEnabled(patch.enabled);
      for (const k of NOTIF_KINDS) {
        const v = patch.kinds?.[k];
        if (v !== undefined) st.setKind(k, v);
      }
      return ok(settingsOf(useNotifStore.getState()));
    },
  };
}
