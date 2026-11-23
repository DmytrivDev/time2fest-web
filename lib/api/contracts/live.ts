/**
 * Контракт домену «Ефір» (`docs/backend/frontend-seam.md`, SPEC-12): ланцюжки джерел трансляцій з їхніми статусами і
 * глядачі. Сервер опитує YouTube Data API (статус, вбудовування) і розсилає зміни; клієнт тримає ланцюжки як кеш і далі
 * сам перемикає джерела за помилками плеєра (`lib/player/chain` лишається клієнтською чистою логікою).
 * Типи дроту — одна копія в `@time2fest/contracts` (`live.ts`); тут лише інтерфейс сервісу.
 */
import type { ChainsResponse, SourceErrorReport, StreamEvent, ViewerSummary } from '@time2fest/contracts';
import type { ApiResult, Unsubscribe } from '../result';

export type {
  ChainsResponse,
  SourceErrorCode,
  SourceErrorReport,
  StreamEvent,
  ViewerCountry,
  ViewerSummary,
} from '@time2fest/contracts';
/**
 * Чисте правило події `live:streams` (сервер і клієнт — одна функція): старіша за останню застосовану версія
 * відкидається, `hide` прибирає джерело, `chain` замінює ланцюжок, `source` — джерело з тим самим `id` (AC-17, AC-18).
 */
export { applyStreamEvent } from '@time2fest/contracts';

export interface LiveService {
  /**
   * Ланцюжки всіх подій з версією: `GET /api/live/chains` — одна публічна адреса без параметрів (AC-3, AC-4; CDN, запасна
   * копія — `live/chains.json` у R2). `version` порівнюється з версіями подій `live:streams` (AC-17).
   */
  chains(): Promise<ApiResult<ChainsResponse>>;
  /**
   * Зміни ланцюжків: події каналу `live:streams` і результати перечитувань (як події `chain` з версією відповіді).
   * Події, що не пройшли схему, не доходять (AC-16).
   */
  subscribeStreams(onEvent: (event: StreamEvent) => void): Unsubscribe;
  /** `GET /api/live/viewers`. */
  viewers(): Promise<ApiResult<ViewerSummary>>;
  /** Realtime: `live:viewers` — агрегат раз на 30–60 с. */
  subscribeViewers(onUpdate: (summary: ViewerSummary) => void): Unsubscribe;
  /** Плеєр не зміг відтворити джерело — сигнал серверу перевірити його позачергово. `POST /api/live/source-errors`. */
  reportSourceError(report: SourceErrorReport): Promise<ApiResult<void>>;
}

