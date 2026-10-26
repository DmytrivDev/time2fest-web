import type { Ms, StreamChain, StreamSource } from '@/lib/data/types';

export type SourceStatus = 'live' | 'expected' | 'possible' | 'none';

/**
 * Похідний статус джерела (`data-model.md` 1.5):
 * `startsAt > now` → `expected`; `expected` після `startsAt` → `live` (з’являється сама);
 * `embeddable = false`, або `live` без `isLive` → `none` (пропускається).
 */
export function sourceStatus(src: StreamSource, now: Ms): SourceStatus {
  if (src.startsAt !== undefined) {
    const starts = Date.parse(src.startsAt);
    if (!Number.isNaN(starts) && starts > now) return 'expected';
  }
  if (!src.embeddable) return 'none';
  if (src.status === 'expected') return src.startsAt !== undefined ? 'live' : 'expected';
  if (src.status === 'live') return src.isLive ? 'live' : 'none';
  return 'possible';
}

/** Чи можна спробувати джерело в плеєрі зараз. */
export function isPlayable(src: StreamSource, now: Ms): boolean {
  const s = sourceStatus(src, now);
  return s === 'live' || s === 'possible';
}

/** Перше придатне джерело за `order` (основне → запасні). */
export function firstPlayableSource(chain: StreamChain | undefined, now: Ms): StreamSource | null {
  if (!chain) return null;
  const sorted = [...chain.sources].sort((a, b) => a.order - b.order);
  return sorted.find((s) => isPlayable(s, now)) ?? null;
}

const RANK: Record<SourceStatus, number> = { live: 3, possible: 2, expected: 1, none: 0 };

/** Найкращий статус ланцюжка; порожній або відсутній → `none` («Лише відлік»). */
export function chainStatus(chain: StreamChain | undefined, now: Ms): SourceStatus {
  let best: SourceStatus = 'none';
  for (const s of chain?.sources ?? []) {
    const st = sourceStatus(s, now);
    if (RANK[st] > RANK[best]) best = st;
  }
  return best;
}
