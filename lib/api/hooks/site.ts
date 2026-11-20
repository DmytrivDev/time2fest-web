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

/**
 * Знімки збірки, віддані як запасні (AC-51). Позначка не йде на дріт: будь-який знімок сервера (і версії 1) заміняє
 * запасний, бо його `version` — не версія сервера.
 */
const fallbacks = new WeakSet<SiteState>();

function fallbackSnapshot(): SiteState {
  const s = buildSnapshot();
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
