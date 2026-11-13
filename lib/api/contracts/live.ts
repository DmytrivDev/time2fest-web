/**
 * Контракт домену «Ефір» (`docs/backend/frontend-seam.md`): ланцюжки джерел трансляцій з їхніми статусами і глядачі.
 * Сервер опитує YouTube Data API (статус, вбудовування) і розсилає зміни; клієнт тримає ланцюжок як кеш і далі сам
 * перемикає джерела за помилками плеєра (`lib/player/chain` лишається клієнтською чистою логікою).
 */
import type { ApiResult, Unsubscribe } from '../result';
import type { ISO, StreamChain, StreamSource } from '@/lib/data/types';

export type StreamEvent =
  /** Змінилось одне джерело (статус, `isLive`, `embeddable`, `startsAt`, запис). */
  | { type: 'source'; eventId: string; source: StreamSource }
  /** Адмінка переставила чи додала джерела — увесь ланцюжок. */
  | { type: 'chain'; chain: StreamChain };

export interface ViewerCountry {
  iso: string;
  name: string;
  flagCode: string;
}

export interface ViewerSummary {
  /** Країни, звідки дивляться зараз (за IP, агрегат; без людей). */
  countries: readonly ViewerCountry[];
  /** Коли сервер порахував. */
  at: ISO;
}

export interface SourceErrorReport {
  eventId: string;
  sourceId: string;
  /** Код помилки YouTube IFrame API (101/150 — не вбудовується, 153 — конфігурація). */
  code: number;
}

export interface LiveService {
  /**
   * Ланцюжки подій (усі або вибрані). `GET /api/live/chains?eventIds=…` (CDN `s-maxage=15–30`, запасна копія — статичний
   * JSON у R2, NFR-6).
   */
  chains(eventIds?: readonly string[]): Promise<ApiResult<readonly StreamChain[]>>;
  /** Realtime: канал Centrifugo `live:streams` (один на сайт, рідкі повідомлення). */
  subscribeStreams(onEvent: (event: StreamEvent) => void): Unsubscribe;
  /** `GET /api/live/viewers`. */
  viewers(): Promise<ApiResult<ViewerSummary>>;
  /** Realtime: `live:viewers` — агрегат раз на 30–60 с. */
  subscribeViewers(onUpdate: (summary: ViewerSummary) => void): Unsubscribe;
  /** Плеєр не зміг відтворити джерело — сигнал серверу перевірити його позачергово. `POST /api/live/source-errors`. */
  reportSourceError(report: SourceErrorReport): Promise<ApiResult<void>>;
}

/**
 * Чисте правило застосування події каналу `live:streams` до ланцюжків (сервер і клієнт — одна функція): `source`
 * замінює джерело з тим самим `id` у ланцюжку події (невідомі подія чи джерело — ігноруються: чекаємо `chain`), `chain`
 * замінює ланцюжок цілком. Не змінилось нічого — повертає ту саму мапу (кеш не будить споживачів).
 */
export function applyStreamEvent(chains: ReadonlyMap<string, StreamChain>, event: StreamEvent): ReadonlyMap<string, StreamChain> {
  if (event.type === 'chain') {
    const next = new Map(chains);
    next.set(event.chain.eventId, event.chain);
    return next;
  }
  const chain = chains.get(event.eventId);
  if (!chain || !chain.sources.some((s) => s.id === event.source.id)) return chains;
  const next = new Map(chains);
  next.set(event.eventId, { ...chain, sources: chain.sources.map((s) => (s.id === event.source.id ? event.source : s)) });
  return next;
}
