'use client';

/**
 * Хук домену `site` (SPEC-01): знімок перемикачів і цін. Поки без споживачів. Події до першого завантаження
 * `resource.ts` відкидає, тому тут їх буферизуємо в `seen` і зливаємо з відповіддю `state()` правилом `applySiteEvent`.
 */
import { createResource, useResource, type ResourceStatus } from '../resource';
import { applySiteEvent, type SiteEvent, type SiteState } from '../contracts/site';
import { ok } from '../result';
import { getService } from '../services';
import { buildSnapshot } from '../site/buildSnapshot';
import { sitePrices, type SitePrices } from '@/lib/offers/prices';
import { getData } from '@/lib/data/load';
import { withEventPatches } from '@/lib/data/patched';
import type { Dataset } from '@/lib/data/types';

/**
 * Знімки збірки, віддані як запасні (AC-51). Позначка не йде на дріт: будь-який знімок сервера (і версії 1) заміняє
 * запасний, бо його `version` — не версія сервера.
 */
const fallbacks = new WeakSet<SiteState>();

function fallbackSnapshot(): SiteState {
  const s = buildSnapshot(getData().meta);
  fallbacks.add(s);
  return s;
}

/** `applySiteEvent`, але запасний знімок збірки поступається будь-якому знімку сервера. */
export function reduceSite(current: SiteState, event: SiteEvent): SiteState {
  return fallbacks.has(current) ? event.state : applySiteEvent(current, event);
}

export const siteState = createResource<SiteState, SiteEvent>(() => {
  const svc = getService('site');
  let seen: SiteState | undefined;
  return {
    load: async () => {
      const r = await svc.state();
      if (r.ok) return seen ? ok(applySiteEvent(r.value, { type: 'snapshot', state: seen })) : r;
      // Читання не вдалося (AC-51): останній застосований знімок, а без нього — знімок збірки.
      return ok(seen ?? svc.peek() ?? fallbackSnapshot());
    },
    subscribe: (cb) =>
      svc.subscribe((e) => {
        seen = applySiteEvent(seen, e);
        cb(e);
      }),
    reduce: reduceSite,
    peek: () => svc.peek(),
  };
});

export function useSiteState(): { status: ResourceStatus; state: SiteState | undefined } {
  const st = useResource(siteState);
  return { status: st.status, state: st.data };
}

/** Показувані ціни: зі знімка, а без знімка чи без продукту — значення збірки. */
export function useSitePrices(): SitePrices {
  return sitePrices(useSiteState().state);
}

/**
 * Дані каталогу з поправками моменту подій зі знімка (AC-53/54). Без поправок `moment` — сам `getData()` (та сама
 * посилання); той самий набір моментів у новому знімку — той самий об’єкт.
 */
export function usePatchedData(): Dataset {
  return withEventPatches(getData(), useSiteState().state?.eventPatches);
}

/** `usePatchedData()` для коду поза React (рушій ефіру, планувальник): читає поточний знімок кешу без підписки. */
export function patchedData(): Dataset {
  return withEventPatches(getData(), siteState.getSnapshot().data?.eventPatches);
}
