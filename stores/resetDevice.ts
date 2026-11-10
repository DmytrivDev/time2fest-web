/**
 * «Скинути стан гостя» (машина часу, `window.__t2f.resetGuest`) — увесь стан сайту на пристрої, як у новому браузері
 * (правка власника 2026-11-10: раніше скидався лише `t2f:guest:v1`, а вхід і пас акаунта лишались, і пас повертався
 * з наступним входом). Скидає: гостя (пас на пристрої, графік, штампи, кімнату, нік, згоду cookies), вхід і імітований
 * сервер акаунтів (`t2f:auth:v1`: акаунти, паси, лист), незавершені оплати пасу, «Першого ряду» й чайових,
 * налаштування кабінету, чату, сповіщення, режим вечірки. Машину часу й перемикачі тестової панелі не чіпає.
 */
import { resetGuest } from '@/stores/guest';
import { useAccountStore } from '@/stores/account';
import { useAuthStore } from '@/stores/auth';
import { useChatPrefs } from '@/stores/chatPrefs';
import { useFirstRowStore } from '@/stores/firstRow';
import { NOTIF_KINDS, useNotifStore } from '@/stores/notifications';
import { usePassStore } from '@/stores/pass';
import { useTipsStore } from '@/stores/tips';
import { useTvPrefs } from '@/stores/tv';

/** Префікс ключів сайту в `localStorage`. */
const PREFIX = 't2f:';

export function resetDeviceState(): void {
  usePassStore.getState().reset();
  useTipsStore.getState().reset();
  useFirstRowStore.getState().reset();
  useFirstRowStore.setState({ flow: null });
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {} });
  useAccountStore.getState().reset();
  useChatPrefs.getState().reset();
  useNotifStore.setState({ items: [], enabled: true, kinds: Object.fromEntries(NOTIF_KINDS.map((k) => [k, true])) as Record<(typeof NOTIF_KINDS)[number], boolean> });
  useTvPrefs.setState({ show: 'all', welcomed: false });
  resetGuest();
  // Сховища вище щойно записали типові значення — прибираємо й їх: після перезавантаження сайт як уперше.
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  } catch {
    /* сховище недоступне — у пам’яті вже скинуто */
  }
}
