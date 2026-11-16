/**
 * Контракт домену «Паспорт» (`docs/backend/frontend-seam.md`, E5b): штампи видає СЕРВІС за підтвердженою присутністю, а не
 * сторінка. Сторінка лише повідомляє, які події показує (`trackPresence`), і отримує видані штампи (`granted`).
 * Правило «присутній опівночі» (`lib/engine/presence`) — чиста функція: у `sim` за ним вирішує адаптер, на сервері — бекенд
 * (та сама функція в спільному пакеті або перенесена копія з тими самими тестами).
 * Реєстр відкритих поверхонь для локального планувальника моментів (`lib/presence/surfaces`) — клієнтський, лишається.
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { Ms, PresenceSource, Stamp } from '@/lib/data/types';

/** Причини відмови підтвердження штампа (`ApiError.reason`). */
export type PassportClaimReason =
  /** `conflict`: вікно підтвердження закрито. */
  | 'claim-closed'
  /** `not_found`: подія невідома. */
  | 'unknown-event';

export interface PresenceBeat {
  /** Події, які сторінка показує зараз (ефір, країна, кімната, ТВ). */
  eventIds: readonly string[];
  source: PresenceSource;
  /** Коли сторінка почала показувати (за серверним часом `/api/time`). */
  openedAt: Ms;
}

/** Запит підтвердити штамп: сторінка бачила присутність опівночі (те саме чисте правило `lib/engine/presence`). */
export interface StampClaim {
  eventId: string;
  source: PresenceSource;
  /** Коли штамп показано людині (+15 с після півночі, час сайту). */
  at: Ms;
}

/** Поверхня сторінки для `trackPresence`. `openedAt` — коли сторінка почала показувати кожну подію (хук тримає між рендерами). */
export interface PresenceSurfaceInput {
  source: PresenceSource;
  eventIds: readonly string[];
  /** id події → відколи показується; адаптер може зсунути назад (машина часу перемотала). */
  openedAt: Map<string, Ms>;
}

/** Годинник сайту (серверний час / машина часу), за яким рахується присутність. */
export interface PresenceClock {
  /** Час останнього такту (0 — годинник ще не тикнув). */
  now(): Ms;
  /** Відколи рахувати нову поверхню, якщо такту ще не було (серверний час без машини часу). */
  fallbackNow(): Ms;
  subscribe(onTick: () => void): Unsubscribe;
}

export type PassportEvent =
  /** Видано штамп (опівночі +15 с, якщо присутність покрила північ). */
  | { type: 'granted'; stamp: Stamp }
  /** Увесь список (скидання гостя; у `http` — після відновлення з’єднання чи об’єднання з акаунтом). */
  | { type: 'snapshot'; stamps: readonly Stamp[] };

export interface PassportService {
  /** Свої штампи. `GET /api/me/stamps`. */
  stamps(): Promise<ApiResult<readonly Stamp[]>>;
  /** Останній відомий список без запиту (кеш на пристрої) — перший кадр після гідратації без «порожнього паспорта». */
  peek?(): readonly Stamp[] | undefined;
  /** Realtime: особистий канал `user:#<userId>` (тип `stamp`). */
  subscribe(onEvent: (event: PassportEvent) => void): Unsubscribe;
  /**
   * Сторінка відкрита й показує події (або `null` — сторінка ефіру без події: штампи за подію, від якої щойно пішли,
   * однаково видаються). У `http` — пульс `beat` поблизу півночі; у `sim` — реєстр поверхонь і рішення про штамп.
   */
  trackPresence(surface: PresenceSurfaceInput | null, clock: PresenceClock): Unsubscribe;
  /**
   * Пульс присутності (примітив `http`): поки сторінка показує подію поблизу її півночі — раз на `nextBeatMs`.
   * `POST /api/presence`. Сервер відповідає, коли надіслати наступний (далеко від півночі — рідко або ніколи).
   */
  beat(beat: PresenceBeat): Promise<ApiResult<{ nextBeatMs: number | null }>>;
  /**
   * Підтвердити штамп (`POST /api/me/stamps`; стан шва №14, 2026-11-14): клієнт опівночі +15 с показує штамп одразу
   * і просить сервер записати його; сервер перевіряє пульси присутності й відповідає штампом (ідемпотентно — уже
   * виданий штамп повертає той самий). Відмова мережі — клієнт повторює у фоні (`lib/passport/stampClaims`); `forbidden`
   * (присутності не було) — штамп знімається. Подія `granted` у каналі може прийти й без цього запиту (пульс).
   */
  claim(req: StampClaim): Promise<ApiResult<Stamp>>;
  /**
   * Штампи гостя → акаунт після входу (`POST /api/me/stamps/merge`, відповідь — подія `snapshot`). Тексти інтерфейсу це
   * обіцяють, але НЕ реалізовано ні в `sim`, ні на сервері (відкрите питання, документ шва). Тому метод необов’язковий.
   */
  mergeGuest?(): Promise<ApiResult<{ merged: number }>>;
}

/** Застосувати подію до списку штампів (один штамп на подію). */
export function applyPassportEvent(stamps: readonly Stamp[], event: PassportEvent): readonly Stamp[] {
  if (event.type === 'snapshot') return event.stamps;
  return stamps.some((s) => s.eventId === event.stamp.eventId) ? stamps : [...stamps, event.stamp];
}
