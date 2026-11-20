/**
 * Дані каталогу з поправками моменту подій зі знімка `site` (SPEC-08, AC-53/54, FR-CLK-20). Чиста функція без React.
 *
 * - Немає жодної поправки `moment`, що справді зсуває відому подію, — повертає той самий `data` (та сама посилання:
 *   споживачі `useMemo(…, [])` і залежності ефектів не перераховуються).
 * - Інакше — новий `Dataset`, де виправлені події мають `midnightMs = moment` і `midnightUtc` у тому самому форматі ISO,
 *   а `eventsById` і `eventsBySlot` перебудовано тим самим правилом, що й `buildDataset` (`lib/data/build.ts`).
 * - Той самий набір моментів (новий знімок з іншими змінами) — той самий результат: кеш за підписом моментів.
 */
import type { Dataset, Ms, ScheduledEvent, SlotGroup } from './types';

/** Поправка події зі знімка; тут важить лише `moment` (мс). */
export interface MomentPatch {
  moment?: number;
}

export type EventPatches = Readonly<Record<string, MomentPatch>>;

/** Останній результат на кожен набір даних: підпис моментів → виправлений набір. */
const cache = new WeakMap<Dataset, { sig: string; result: Dataset }>();

/** Формат `schedule.json`: секунди без мілісекунд (`2026-12-31T10:00:00Z`). */
function isoOf(ms: Ms): string {
  const iso = new Date(ms).toISOString();
  return iso.endsWith('.000Z') ? `${iso.slice(0, -5)}Z` : iso;
}

/** Поправки, що справді зсувають відому подію, — у стабільному порядку id. */
function effectiveMoments(data: Dataset, patches: EventPatches): [string, Ms][] {
  const out: [string, Ms][] = [];
  for (const id of Object.keys(patches).sort()) {
    const moment = patches[id]?.moment;
    if (typeof moment !== 'number' || !Number.isFinite(moment)) continue;
    const event = data.eventsById.get(id);
    if (event && event.midnightMs !== moment) out.push([id, moment]);
  }
  return out;
}

function patchDataset(data: Dataset, moments: ReadonlyMap<string, Ms>): Dataset {
  const events = data.events.map((e): ScheduledEvent => {
    const moment = moments.get(e.id);
    return moment === undefined ? e : { ...e, midnightMs: moment, midnightUtc: isoOf(moment) };
  });

  // Те саме правило, що в `buildDataset`: група на кожен момент, перша подія задає `midnightUtc` і `zoneId`.
  const bySlot = new Map<number, SlotGroup>();
  for (const e of events) {
    let g = bySlot.get(e.midnightMs);
    if (!g) {
      g = { midnightMs: e.midnightMs, midnightUtc: e.midnightUtc, zoneId: e.zoneId, events: [] };
      bySlot.set(e.midnightMs, g);
    }
    g.events.push(e);
  }
  const eventsBySlot = [...bySlot.values()].sort((a, b) => a.midnightMs - b.midnightMs);

  return {
    ...data,
    events,
    eventsById: new Map(events.map((e) => [e.id, e])),
    eventsBySlot,
  };
}

/** `data` з поправками моменту подій; без поправок `moment` — сам `data`. */
export function withEventPatches(data: Dataset, patches: EventPatches | null | undefined): Dataset {
  if (!patches) return data;
  const moments = effectiveMoments(data, patches);
  if (moments.length === 0) return data;
  const sig = moments.map(([id, m]) => `${id}=${m}`).join('|');
  const hit = cache.get(data);
  if (hit?.sig === sig) return hit.result;
  const result = patchDataset(data, new Map(moments));
  cache.set(data, { sig, result });
  return result;
}
