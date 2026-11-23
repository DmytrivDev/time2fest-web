/**
 * Адаптер `sim` домену «Ефір»: ланцюжки — з каталогу збірки (`data/streams*.json`, версія 0), глядачі — імітація
 * `currentViewers` і демо-число людей `SIMULATED_PEOPLE` (лише в тестовій і демо-збірці, у робочій — порожньо, AC-67). Нічого не змінюється під час сеансу,
 * тож підписки порожні; звітів про помилки джерел «сервер» імітації не потребує.
 */
import { ok } from '../result';
import type { LiveService, ViewerSummary } from '../contracts/live';
import { getData } from '@/lib/data/load';
import { currentViewers, SIMULATED_PEOPLE, SIMULATED_PRESENCE } from '@/lib/presence/viewers';

export function createSimLive(): LiveService {
  return {
    async chains() {
      return ok({ version: 0, at: new Date().toISOString(), chains: [...getData().chainsByEventId.values()] });
    },
    subscribeStreams: () => () => undefined,
    async viewers() {
      const summary: ViewerSummary = {
        countries: currentViewers(getData()),
        ...(SIMULATED_PRESENCE ? { people: SIMULATED_PEOPLE } : {}),
        at: new Date().toISOString(),
      };
      return ok(summary);
    },
    subscribeViewers: () => () => undefined,
    async reportSourceError() {
      return ok(undefined);
    },
  };
}
