/**
 * Адаптер `sim` домену «Ефір»: ланцюжки — з каталогу збірки (`data/streams*.json`), глядачі — імітація
 * `currentViewers` (лише в тестовій і демо-збірці, у робочій — порожньо). Нічого не змінюється під час сеансу,
 * тож підписки порожні; звітів про помилки джерел «сервер» імітації не потребує.
 */
import { ok } from '../result';
import type { LiveService, ViewerSummary } from '../contracts/live';
import { getData } from '@/lib/data/load';
import { currentViewers } from '@/lib/presence/viewers';

export function createSimLive(): LiveService {
  return {
    async chains(eventIds) {
      const all = getData().chainsByEventId;
      return ok(eventIds ? eventIds.flatMap((id) => all.get(id) ?? []) : [...all.values()]);
    },
    subscribeStreams: () => () => undefined,
    async viewers() {
      const summary: ViewerSummary = { countries: currentViewers(getData()), at: new Date().toISOString() };
      return ok(summary);
    },
    subscribeViewers: () => () => undefined,
    async reportSourceError() {
      return ok(undefined);
    },
  };
}
