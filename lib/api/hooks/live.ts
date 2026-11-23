'use client';

/**
 * Хуки домену «Ефір» (`docs/backend/frontend-seam.md`): ланцюжки джерел трансляцій і глядачі.
 * Ланцюжки — один ресурс кешу на сайт: стартове значення — ланцюжки зі збірки (`data/streams*.json`, без блимання
 * плеєра й без очікування мережі), далі `load()` і події `live:streams` лише вносять поправки (статус, `embeddable`,
 * `startsAt`, запис, приховування). Версії (AC-17): ресурс пам'ятає останню застосовану; старіша подія чи відповідь
 * відкидається, події, що прийшли під час завантаження, накладаються після нього. Для коду поза React (планувальник
 * подій, `BroadcastController`) — `getStreamChains()`: той самий кеш без підписки (споживач, що рендериться, тримає
 * ресурс підключеним через `useStreamChains`).
 */
import { useMemo } from 'react';
import { isEnabled } from '@time2fest/contracts';
import { applyStreamEvent, type StreamEvent, type ViewerCountry, type ViewerSummary } from '../contracts/live';
import { createResource, useResource, type Resource } from '../resource';
import { getService } from '../services';
import { ok, type ApiResult } from '../result';
import { buildSnapshot } from '../site/buildSnapshot';
import { usePatchedData, useSiteState } from './site';
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

/**
 * Версія даних кешу: остання застосована (подією чи відповіддю). Кеш без даних (старт, `reset`) — ланцюжки збірки,
 * версії ще немає (-1), тож будь-яка відповідь сервера їх замінює.
 */
let appliedVersion = -1;
const currentVersion = (): number => (streamChains.getSnapshot().data === undefined ? -1 : appliedVersion);

export const streamChains: Resource<Chains> = createResource<Chains, StreamEvent>(() => {
  const svc = getService('live');
  /** Події, що прийшли, поки йде `load()`: у ресурс вони не йдуть, а накладаються на відповідь (AC-17). */
  let pending: StreamEvent[] | null = null;
  return {
    async load(): Promise<ApiResult<Chains>> {
      const mine: StreamEvent[] = [];
      pending = mine;
      const res = await svc.chains();
      if (pending === mine) pending = null;
      const current = streamChains.getSnapshot().data ?? buildChains();
      let version = currentVersion();
      let chains = current;
      if (res.ok && res.value.version >= version) {
        chains = settle(new Map<string, StreamChain>(res.value.chains.map((c) => [c.eventId, c])), current);
        version = res.value.version;
      }
      for (const event of mine) ({ chains, version } = applyStreamEvent(chains, event, version));
      // Відмова без подій — ресурс лишає останні дані, а без них хуки беруть ланцюжки збірки (AC-20).
      if (!res.ok && mine.length === 0) return res;
      appliedVersion = version;
      return ok(chains);
    },
    subscribe: (cb) =>
      svc.subscribeStreams((event) => {
        if (pending) pending.push(event);
        else cb(event);
      }),
    reduce(data, event) {
      const next = applyStreamEvent(data, event, appliedVersion);
      appliedVersion = next.version;
      return next.chains;
    },
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

/**
 * Скільки людей зараз на сайті (рядок «Зараз на Time2Fest {count} людей», AC-64): число агрегату, коли воно > 0 і
 * вимикач `viewersCount` увімкнено; інакше — `undefined` (рядка немає). До знімка `site` — вимикачі знімка збірки.
 */
export function usePeopleNow(): number | undefined {
  const people = useResource(viewerSummary).data?.people;
  const switches = useSiteState().state?.switches ?? buildSnapshot(getData().meta).switches;
  return people !== undefined && people > 0 && isEnabled(switches, { kind: 'switch', key: 'viewersCount' }) ? people : undefined;
}
