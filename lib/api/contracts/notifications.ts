/**
 * Контракт домену «Сповіщення» (`docs/backend/frontend-seam.md`, розділ «notifications»). Перенесено першим — зразок
 * для інших доменів: компоненти → `lib/api/hooks/notifications` → цей інтерфейс → адаптер `sim` чи `http`.
 *
 * Хто створює сповіщення: сервер (штамп видано, відповідь у чаті, трансляція з графіка почалась, досягнення паспорта).
 * У `sim` це робить `lib/api/sim/NotificationsGenerator` у браузері. Налаштування сервер теж враховує сам: вимкнений
 * тип не створюється (і не йде поштою чи push).
 */
import type { ApiResult, Unsubscribe } from '../result';

export const NOTIF_KINDS = ['live', 'stamp', 'reply', 'goal', 'streak'] as const;
export type NotifKind = (typeof NOTIF_KINDS)[number];

export interface Notif {
  /** Стабільний ключ (`stamp:<eventId>` тощо) — одне сповіщення на подію; сервер дедуплікує за ним. */
  id: string;
  kind: NotifKind;
  createdAt: number;
  read: boolean;
  /** Параметри тексту (`notif.items.<kind>`): тексти робить клієнт, сервер дає лише дані. */
  params: Record<string, string | number>;
  /** Куди веде дія (шлях сайту). */
  href: string;
  /** Прапор на значку (ISO). */
  flag?: string;
}

export interface NotifSettings {
  /** «Усі сповіщення». */
  enabled: boolean;
  kinds: Record<NotifKind, boolean>;
}

export interface NotifSettingsPatch {
  enabled?: boolean;
  kinds?: Partial<Record<NotifKind, boolean>>;
}

export type NotifReadTarget = { ids: readonly string[] } | 'all';

/**
 * Realtime-події (у `http` — особистий канал Centrifugo `notif:user#<userId>`; у `sim` — підписка на стор).
 * `snapshot` — повний список (після відновлення з’єднання без історії; `sim` шле лише його).
 */
export type NotifEvent =
  | { type: 'added'; item: Notif }
  | { type: 'read'; target: NotifReadTarget }
  | { type: 'snapshot'; items: readonly Notif[] }
  | { type: 'settings'; settings: NotifSettings };

export interface NotificationsService {
  /** Список, нові зверху (останні 60). `GET /api/me/notifications`. */
  list(): Promise<ApiResult<readonly Notif[]>>;
  /** Realtime: нові, прочитані на іншому пристрої, зміна налаштувань. */
  subscribe(onEvent: (event: NotifEvent) => void): Unsubscribe;
  /** Позначити прочитаними. `POST /api/me/notifications/read` `{ ids } | { all: true }`. */
  markRead(target: NotifReadTarget): Promise<ApiResult<void>>;
  /** `GET /api/me/notification-settings`. */
  getSettings(): Promise<ApiResult<NotifSettings>>;
  /** `PATCH /api/me/notification-settings` — повертає збережене. */
  updateSettings(patch: NotifSettingsPatch): Promise<ApiResult<NotifSettings>>;
}

export const DEFAULT_NOTIF_SETTINGS: NotifSettings = {
  enabled: true,
  kinds: Object.fromEntries(NOTIF_KINDS.map((k) => [k, true])) as Record<NotifKind, boolean>,
};

/** Застосувати подію до списку (чиста функція: кеш клієнта і тести). */
export function applyNotifEvent(items: readonly Notif[], event: NotifEvent): readonly Notif[] {
  switch (event.type) {
    case 'snapshot':
      return event.items;
    case 'added':
      return items.some((x) => x.id === event.item.id) ? items : [event.item, ...items];
    case 'read': {
      const target = event.target;
      if (target === 'all') return items.map((x) => (x.read ? x : { ...x, read: true }));
      const ids = new Set(target.ids);
      return items.map((x) => (ids.has(x.id) && !x.read ? { ...x, read: true } : x));
    }
    default:
      return items;
  }
}

/** Застосувати зміну до налаштувань (оптимістично, як зробить сервер). */
export function applyNotifSettingsPatch(s: NotifSettings, patch: NotifSettingsPatch): NotifSettings {
  return { enabled: patch.enabled ?? s.enabled, kinds: { ...s.kinds, ...patch.kinds } as Record<NotifKind, boolean> };
}
