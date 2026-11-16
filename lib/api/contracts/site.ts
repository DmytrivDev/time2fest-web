/**
 * Контракт домену `site` (proposed, SPEC-01): перемикачі, ціни й правки подій від сервера. Джерело — пакет
 * `@time2fest/contracts` (`packages/contracts/src/site.ts`); тут лише реекспорт для шару `lib/api`.
 */
export type { SiteState, SiteSwitches, SiteProduct, ProductKey, Money, SiteEventPatch, SiteEvent, SiteService } from '@time2fest/contracts';
export { applySiteEvent, catalogVersionOf } from '@time2fest/contracts';
