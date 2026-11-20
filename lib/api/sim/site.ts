/**
 * Адаптер `sim` домену `site` (SPEC-01): знімок збірки (`../site/buildSnapshot`) — усе ввімкнено, ціни з PRD. Подій не шле.
 */
import { ok } from '../result';
import { applySiteEvent, type SiteEvent, type SiteService, type SiteState } from '../contracts/site';
import { buildSnapshot } from '../site/buildSnapshot';

let last: SiteState | undefined;

export function createSimSite(): SiteService {
  const listeners = new Set<(event: SiteEvent) => void>();
  return {
    async state() {
      const s = buildSnapshot();
      last = s;
      return ok(s);
    },
    subscribe(cb) {
      const l = (e: SiteEvent) => {
        last = applySiteEvent(last, e);
        cb(e);
      };
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    peek: () => last,
  };
}

export function resetSimSiteForTest(): void {
  last = undefined;
}
