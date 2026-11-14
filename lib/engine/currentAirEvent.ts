import type {
  Country,
  EventRuntime,
  ISO,
  Ms,
  ScheduledEvent,
  SlotGroup,
  StreamChain,
  StreamSource,
} from '@/lib/data/types';
import { CELEBRATION_TAIL } from './celebration';
import { HANDOVER_AFTER } from './config';
import { toRuntime } from './eventStatus';
import { chainStatus, firstPlayableSource } from './sourceStatus';

export type AirView = 'stream' | 'countdown-scene' | 'expected-scene' | 'festival-over';

export interface AirState {
  event: EventRuntime | null;
  slotMidnightUtc: ISO | null;
  nextEvent: EventRuntime | null;
  source: StreamSource | null;
  view: AirView;
  handoverAt: Ms | null;
}

export interface AirSchedule {
  eventsBySlot: readonly SlotGroup[];
  countriesByIso: ReadonlyMap<string, Pick<Country, 'popularity'>>;
}

export type ChainIndex = ReadonlyMap<string, StreamChain>;

interface Pick_ {
  event: ScheduledEvent;
  source: StreamSource | null;
  view: Exclude<AirView, 'festival-over'>;
}

/** Слоти ефіру: унікальні моменти півночі з подіями `isMainCelebration`, за зростанням. */
export function airSlots(schedule: AirSchedule): { midnightMs: Ms; midnightUtc: ISO; events: ScheduledEvent[] }[] {
  const out: { midnightMs: Ms; midnightUtc: ISO; events: ScheduledEvent[] }[] = [];
  for (const slot of schedule.eventsBySlot) {
    const events = slot.events.filter((e) => e.isMainCelebration);
    if (events.length) out.push({ midnightMs: slot.midnightMs, midnightUtc: slot.midnightUtc, events });
  }
  return out.sort((a, b) => a.midnightMs - b.midnightMs);
}

/**
 * Індекс поточного слота: перший, для якого `now < midnight + 15 хв`; −1 — свято скінчилося. Останній слот передавати нікуди,
 * тому він лишається в ефірі до кінця свята — `CELEBRATION_TAIL` після останньої півночі (рішення власника 2026-11-14):
 * тости ще приймаються, і сайт не каже «свято завершено» раніше.
 */
export function currentSlotIndex(now: Ms, slots: readonly { midnightMs: Ms }[]): number {
  const last = slots.length - 1;
  return slots.findIndex((s, i) => (i === last ? now <= s.midnightMs + CELEBRATION_TAIL : now < s.midnightMs + HANDOVER_AFTER));
}

/**
 * Вибір події слота (FR-010, FR-015): спершу з придатним джерелом, потім з очікуваним,
 * потім без джерел; далі `popularity` ↓, `Country.popularity` ↓, `id` ↑.
 */
export function pickSlotEvent(
  now: Ms,
  events: readonly ScheduledEvent[],
  countriesByIso: AirSchedule['countriesByIso'],
  chains: ChainIndex,
): Pick_ | null {
  let best: (Pick_ & { rank: number }) | null = null;
  for (const event of events) {
    const chain = chains.get(event.id);
    const source = firstPlayableSource(chain, now);
    const status = chainStatus(chain, now);
    const rank = source ? 2 : status === 'expected' ? 1 : 0;
    const view: Pick_['view'] = source ? 'stream' : rank === 1 ? 'expected-scene' : 'countdown-scene';
    const cand = { event, source, view, rank };
    if (!best || better(cand, best, countriesByIso)) best = cand;
  }
  return best ? { event: best.event, source: best.source, view: best.view } : null;
}

function better(
  a: { event: ScheduledEvent; rank: number },
  b: { event: ScheduledEvent; rank: number },
  countries: AirSchedule['countriesByIso'],
): boolean {
  if (a.rank !== b.rank) return a.rank > b.rank;
  if (a.event.popularity !== b.event.popularity) return a.event.popularity > b.event.popularity;
  const ca = countries.get(a.event.countryIso)?.popularity ?? 0;
  const cb = countries.get(b.event.countryIso)?.popularity ?? 0;
  if (ca !== cb) return ca > cb;
  return a.event.id < b.event.id;
}

/** `data-model.md` 3.1. */
export function currentAirEvent(now: Ms, schedule: AirSchedule, streams: ChainIndex): AirState {
  const slots = airSlots(schedule);
  const i = currentSlotIndex(now, slots);
  if (i === -1) {
    return { event: null, slotMidnightUtc: null, nextEvent: null, source: null, view: 'festival-over', handoverAt: null };
  }
  const slot = slots[i]!;
  const cur = pickSlotEvent(now, slot.events, schedule.countriesByIso, streams)!;
  const nextSlot = slots[i + 1];
  const next = nextSlot ? pickSlotEvent(now, nextSlot.events, schedule.countriesByIso, streams) : null;
  return {
    event: toRuntime(now, cur.event),
    slotMidnightUtc: slot.midnightUtc,
    nextEvent: next ? toRuntime(now, next.event) : null,
    source: cur.source,
    view: cur.view,
    handoverAt: slot.midnightMs + HANDOVER_AFTER,
  };
}
