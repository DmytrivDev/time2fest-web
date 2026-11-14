/**
 * Чисті помічники кімнати перегляду: посилання «Поділитися кімнатою» (`?w=`), ланцюг джерел події, назва й прапор
 * вікна за даними. Без React; виокремлено з `RoomLive.tsx` (WP-F).
 */
import { SITE_HOST } from '@/lib/config/site';
import type { Dataset, GuestRoomWindow } from '@/lib/data/types';
import type { PlayerChainInput } from '@/lib/player/PlayerProvider';
import { posOf } from '@/stores/room';

/** Ланцюжок події для вікна кімнати: обрана трансляція як є (без заглушки головного святкування, як у `countryChainInput`). */
export function roomChainInput(data: Dataset, eventId: string, preferredSourceId?: string): PlayerChainInput {
  const sources = data.chainsByEventId.get(eventId)?.sources ?? [];
  return preferredSourceId ? { eventId, sources, preferredSourceId } : { eventId, sources };
}

export function sourceTitle(data: Dataset, w: Pick<GuestRoomWindow, 'eventId' | 'sourceId'>): string {
  const src = data.chainsByEventId.get(w.eventId)?.sources.find((x) => x.id === w.sourceId);
  if (src) return src.title.uk;
  const ev = data.eventsById.get(w.eventId);
  return ev ? (data.citiesById.get(ev.cityId)?.name.uk ?? '') : '';
}

export function flagOf(data: Dataset, eventId: string): string {
  const ev = data.eventsById.get(eventId);
  const c = ev ? data.countriesByIso.get(ev.countryIso) : undefined;
  return c?.flagCode ?? ev?.countryIso.toLowerCase() ?? '';
}

/**
 * Посилання «Поділитися кімнатою»: `?w=` — джерела за місцями сітки (0 — верхнє ліве … 3 — нижнє праве), порожнє місце —
 * порожній елемент: `?w=a,,,b` — вікна на місцях 1 і 4. Друг бачить трансляції на тих самих місцях.
 */
export function roomShareUrl(windows: readonly GuestRoomWindow[], origin = typeof window !== 'undefined' ? window.location.origin : `https://${SITE_HOST}`): string {
  const byPos: string[] = [];
  windows.forEach((w, i) => {
    byPos[posOf(w, i)] = encodeURIComponent(w.sourceId);
  });
  return `${origin}/room/?w=${Array.from(byPos, (x) => x ?? '').join(',')}`;
}

/** `?w=` → вікна з місцями сітки; невідомі джерела й повтори пропускаємо, місця інших вікон не зсуваються. */
export function parseRoomShare(raw: string, data: Pick<Dataset, 'chainsByEventId'>): GuestRoomWindow[] {
  const list: GuestRoomWindow[] = [];
  raw.split(',').forEach((part, pos) => {
    if (!part || pos > 3) return;
    const id = decodeURIComponent(part);
    if (list.some((w) => w.sourceId === id)) return;
    for (const [eventId, chain] of data.chainsByEventId) {
      if (chain.sources.some((x) => x.id === id)) {
        list.push({ slot: list.length, sourceId: id, eventId, pos });
        return;
      }
    }
  });
  return list;
}
