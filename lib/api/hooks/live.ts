'use client';

/**
 * Хуки домену «Ефір» (`docs/backend/frontend-seam.md`): ланцюжки джерел трансляцій і глядачі.
 * Ланцюжки — один ресурс кешу на сайт: стартове значення — ланцюжки зі збірки (`data/streams*.json`, без блимання
 * плеєра й без очікування мережі), далі `load()` і події `live:streams` лише вносять поправки (статус, `embeddable`,
 * `startsAt`, запис). Для коду поза React (планувальник подій, `BroadcastController`) — `getStreamChains()`: той самий
 * кеш без підписки (споживач, що рендериться, тримає ресурс підключеним через `useStreamChains`).
 */
import { useMemo } from 'react';
import { applyStreamEvent, type StreamEvent, type ViewerCountry, type ViewerSummary } from '../contracts/live';
import { createResource, useResource, type Resource } from '../resource';
import { getService } from '../services';
import { ok, type ApiResult } from '../result';
import { usePatchedData } from './site';
import { getData } from '@/lib/data/load';
import type { Dataset, StreamChain } from '@/lib/data/types';

type Chains = ReadonlyMap<string, StreamChain>;

/** Ланцюжки зі збірки: стартове й запасне значення (NFR-6: сервер ліг — трансляції грають). */
const buildChains = (): Chains => getData().chainsByEventId;

/** Відповідь сервісу, що нічого не змінила (ті самі об’єкти), — та сама мапа: споживачі не перераховуються. */
function settle(next: Chains, current: Chains): Chains {
  if (next.size !== current.size) return next;
  for (const [id, chain] of next) if (current.get(id) !== chain) return next;
  return current;
}

export const streamChains: Resource<Chains> = createResource<Chains, StreamEvent>(() => {
  const svc = getService('live');
  return {
    async load(): Promise<ApiResult<Chains>> {
      const res = await svc.chains();
      if (!res.ok) return res;
      const next = new Map<string, StreamChain>(res.value.map((c) => [c.eventId, c]));
      return ok(settle(next, streamChains.getSnapshot().data ?? buildChains()));
    },
    subscribe: (cb) => svc.subscribeStreams(cb),
    reduce: applyStreamEvent,
  };
});

/** Усі ланцюжки (`eventId → ланцюжок`). Завжди є значення: до завантаження — ланцюжки зі збірки. */
export function useStreamChains(): Chains {
  return useResource(streamChains).data ?? buildChains();
}

/** Ланцюжок однієї події; немає джерел — `undefined`. */
export function useStreamChain(eventId: string | null | undefined): StreamChain | undefined {
  return useStreamChains().get(eventId ?? '');
}

/** Поточні ланцюжки для коду поза React (планувальник, контролер ефіру). Не підписує — підписник має бути поруч. */
export function getStreamChains(): Chains {
  return streamChains.getSnapshot().data ?? buildChains();
}

/** Дані каталогу з поточними ланцюжками: для чистих функцій `lib/live/*`, `lib/engine/*`, що беруть `Dataset`. */
export function withChains(data: Dataset, chains: Chains): Dataset {
  return chains === data.chainsByEventId ? data : { ...data, chainsByEventId: chains };
}

/**
 * `getData()` з поправками моменту подій (знімок `site`, AC-53/54) і ланцюжками сервера. Та сама посилання, поки не
 * змінились ні поправки моменту, ні ланцюжки (безпечно в залежностях `useMemo`).
 */
export function useLiveData(): Dataset {
  const data = usePatchedData();
  const chains = useStreamChains();
  return useMemo(() => withChains(data, chains), [data, chains]);
}

const NO_VIEWERS: readonly ViewerCountry[] = [];

export const viewerSummary = createResource<ViewerSummary, ViewerSummary>(() => {
  const svc = getService('live');
  return {
    load: () => svc.viewers(),
    subscribe: (cb) => svc.subscribeViewers(cb),
    reduce: (_, summary) => summary,
  };
});

/** Країни, звідки дивляться зараз (рядок «Зараз дивляться люди з …»); до завантаження й без даних — порожньо. */
export function useViewers(): readonly ViewerCountry[] {
  return useResource(viewerSummary).data?.countries ?? NO_VIEWERS;
}
