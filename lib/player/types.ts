/**
 * Типи плеєра. `PlayerSource` — структурна підмножина `StreamSource` з data-model.md 1.5:
 * будь-який `StreamSource` з `lib/data` підходить сюди без перетворення.
 */

export type Ms = number;

export type PlayerSlotId = 'main' | `room:${number}`;

export type PlayerSourcePlatform = 'youtube' | 'facebook' | 'twitch';

export interface PlayerSource {
  id: string;
  platform: PlayerSourcePlatform;
  /** YouTube: 11 символів. */
  videoId?: string;
  url: string;
  /** Позиція в ланцюжку запасних: 0 — основне. */
  order: number;
  status: 'live' | 'expected' | 'possible';
  /**
   * Для `expected`: з цього моменту джерело стає `live` без перезавантаження. Необов’язковий: часто початок невідомий
   * (2026-11-13) — тоді `expected` без `startsAt` чекає, доки дані не скажуть `live`, а заглушка не показує ні часу, ні відліку.
   */
  startsAt?: string;
  embeddable: boolean;
  isLive: boolean;
  /** Цілодобова тестова пряма (TestStream): лишається придатною після півночі. */
  alwaysOn?: boolean;
}

/** Коди `onError` IFrame API, після яких джерело позначається недоступним і береться наступне. */
export type SwitchingErrorCode = 2 | 5 | 100 | 101 | 150;

/** contracts/ui-events.md — `player:source-switched`. */
export interface PlayerSourceSwitched {
  eventKey: string;
  at: Ms;
  slot: PlayerSlotId;
  eventId: string;
  fromSourceId: string;
  toSourceId: string;
  chainIndex: number;
  reason: 'error' | 'not-embeddable' | 'not-live' | 'ended';
  errorCode?: SwitchingErrorCode;
  exhausted?: boolean;
}

/** contracts/ui-events.md — `player:facebook-consent-required`. */
export interface PlayerFacebookConsentRequired {
  eventKey: string;
  at: Ms;
  slot: PlayerSlotId;
  eventId: string;
  sourceId: string;
}

/** Що показує область відео (C1 «Стани VideoArea», частина, яку визначає ланцюжок). */
export type ChainSelection =
  | { kind: 'source'; source: PlayerSource; index: number }
  | { kind: 'facebook-consent'; source: PlayerSource; index: number }
  /**
   * Людина обрала трансляцію, що ще не почалась (`startsAt` попереду; правка власника 2026-11-11): на місці відео —
   * заглушка «Очікуйте трансляцію …», о `startsAt` вибір перераховується й відео стартує саме.
   */
  | { kind: 'waiting'; source: PlayerSource; index: number }
  | { kind: 'countdown-scene' };
