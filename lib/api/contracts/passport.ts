/**
 * Контракт домену «Паспорт» (`docs/backend/frontend-seam.md`): штампи видає СЕРВЕР за підтвердженою присутністю, а не
 * клієнт (`lib/presence/useStampGrant.ts` зараз пише штамп у `guest.stamps` сам). Клієнт лише повідомляє, які події
 * показує сторінка (пульс присутності), і отримує видані штампи.
 * Правило «присутній опівночі» (`lib/engine/presence`) лишається чистою логікою: на клієнті — для підказок, на сервері —
 * для рішення (та сама функція в спільному пакеті або перенесена копія з тими самими тестами).
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms, PresenceSource, Stamp } from '@/lib/data/types';

export interface PresenceBeat {
  /** Події, які сторінка показує зараз (ефір, країна, кімната, ТВ). */
  eventIds: readonly string[];
  source: PresenceSource;
  /** Коли сторінка почала показувати (за серверним часом `/api/time`). */
  openedAt: Ms;
}

export type PassportEvent =
  /** Сервер видав штамп (опівночі +15 с, якщо пульс покрив північ). */
  | { type: 'granted'; stamp: Stamp }
  /** Вхід в акаунт: штампи гостя об’єднано з акаунтом. */
  | { type: 'snapshot'; stamps: readonly Stamp[] };

export interface PassportService {
  /** Свої штампи. `GET /api/me/stamps`. */
  stamps(): Promise<ApiResult<readonly Stamp[]>>;
  /** Realtime: особистий канал `user:#<userId>` (тип `stamp`). */
  subscribe(onEvent: (event: PassportEvent) => void): Unsubscribe;
  /**
   * Пульс присутності: поки сторінка показує подію поблизу її півночі — раз на `nextBeatMs`. `POST /api/presence`.
   * Сервер відповідає, коли надіслати наступний (далеко від півночі — рідко або ніколи).
   */
  beat(beat: PresenceBeat): Promise<ApiResult<{ nextBeatMs: number | null }>>;
}
