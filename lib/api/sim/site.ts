/**
 * Адаптер `sim` домену `site` (SPEC-01): типові значення без сервера — усе ввімкнено, ціни з PRD. Подій не шле.
 */
import { ok } from '../result';
import { applySiteEvent, catalogVersionOf, type SiteEvent, type SiteService, type SiteState } from '../contracts/site';
import { getData } from '@/lib/data/load';

let last: SiteState | undefined;

function defaults(): SiteState {
  const price = (amount: number) => ({ amount, currency: 'USD' as const });
  return {
    version: 1,
    at: new Date(0).toISOString(),
    switches: {
      chat: true,
      toasts: true,
      pass: true,
      passGift: true,
      payments: true,
      viewersMap: true,
      passOffer: true,
      chatRooms: {},
      toastTiers: { '2': true, '5': true, '10': true },
    },
    products: [
      { key: 'pass', price: price(500), priceVersion: 1 },
      { key: 'toast:2', price: price(200), priceVersion: 1 },
      { key: 'toast:5', price: price(500), priceVersion: 1 },
      { key: 'toast:10', price: price(1000), priceVersion: 1 },
    ],
    catalogVersion: catalogVersionOf(getData().meta),
    eventPatches: {},
  };
}

export function createSimSite(): SiteService {
  const listeners = new Set<(event: SiteEvent) => void>();
  return {
    async state() {
      const s = defaults();
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
