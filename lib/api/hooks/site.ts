'use client';

/**
 * Хук домену `site` (SPEC-01): знімок перемикачів і цін. Поки без споживачів. Події до першого завантаження
 * `resource.ts` відкидає, тому тут їх буферизуємо в `seen` і зливаємо з відповіддю `state()` правилом `applySiteEvent`.
 */
import { createResource, useResource, type ResourceStatus } from '../resource';
import { applySiteEvent, type SiteEvent, type SiteState } from '../contracts/site';
import { ok } from '../result';
import { getService } from '../services';

export const siteState = createResource<SiteState, SiteEvent>(() => {
  const svc = getService('site');
  let seen: SiteState | undefined;
  return {
    load: async () => {
      const r = await svc.state();
      return r.ok && seen ? ok(applySiteEvent(r.value, { type: 'snapshot', state: seen })) : r;
    },
    subscribe: (cb) =>
      svc.subscribe((e) => {
        seen = applySiteEvent(seen, e);
        cb(e);
      }),
    reduce: applySiteEvent,
    peek: () => svc.peek(),
  };
});

export function useSiteState(): { status: ResourceStatus; state: SiteState | undefined } {
  const st = useResource(siteState);
  return { status: st.status, state: st.data };
}
