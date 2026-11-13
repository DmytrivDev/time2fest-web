/**
 * Контракт домену «Тости» (`docs/backend/frontend-seam.md`): стрічка опублікованих тостів (смуга під плеєром, чат,
 * привітання опівночі). Купівля тосту — НЕ тут, а в спільному `checkout` (тост з’являється тут, коли оплату підтверджено
 * вебхуком PayPro). Правила смуги (`lib/toast/feed`), рівні (`tiers`) і фільтр тексту (`filter`) — чиста логіка, лишається.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms } from '@/lib/data/types';
import type { ToastRecord } from '@/lib/toast/feed';
import type { ToastIssue } from '@/lib/toast/filter';

export type ToastEvent =
  /** Новий опублікований тост (після оплати). */
  | { type: 'published'; toast: ToastRecord }
  /** Модерація прибрала тост (гроші — окремо, через підтримку). */
  | { type: 'removed'; id: string };

export interface ToastsService {
  /** Опубліковані тости свята, старі першими. `GET /api/toasts?since=` (CDN `s-maxage=10`). */
  list(opts?: { since?: Ms }): Promise<ApiResult<readonly ToastRecord[]>>;
  /** Realtime: канал Centrifugo `toasts` (і системне повідомлення в `chat:world`). */
  subscribe(onEvent: (event: ToastEvent) => void): Unsubscribe;
  /** Свої тости (позначка `mine`). `GET /api/me/toasts`. */
  mine(): Promise<ApiResult<readonly ToastRecord[]>>;
  /**
   * Перевірити текст до оплати тим самим фільтром, що й сервер. `POST /api/toasts/check`.
   * Відмова — `validation` з `reason` = `ToastIssue.kind`; деталі (де саме) — у `issue`.
   */
  check(text: string): Promise<ApiResult<{ issue: ToastIssue | null }>>;
}
