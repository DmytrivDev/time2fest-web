/**
 * Ядро `EngineScheduler` (`contracts/ui-events.md`): раз на секунду від джерела часу
 * обчислює похідний стан двигунів і порівнює з попереднім тактом — **перепад → подія**.
 *
 * - Кожна подія має `eventKey`; ключі вже емітованих подій живуть у `sessionStorage`,
 *   тож повторне відкриття вкладки чи перемотка назад не повторюють подію.
 * - Пропущені переходи (вкладка спала, великий стрибок часу) емітуються один раз з `late: true`.
 * - Компоненти малюють стан із двигунів; події — лише для оголошень і одноразових переходів.
 */
import type { Country, Ms, PresenceSource, SlotGroup, StreamChain } from '@/lib/data/types';
import { airSlots, currentAirEvent, pickSlotEvent } from '@/lib/engine/currentAirEvent';
import { momentTimeline, zonePassedHandover } from '@time2fest/rules/time';
import { offerEligibility, type OfferContext } from '@/lib/engine/offerEligibility';
import type { UiEventMap, UiEventType } from './types';

export const EMITTED_KEY = 't2f:session:emittedEvents';
export const LAST_TICK_KEY = 't2f:session:schedulerTick';
/** Скільки ключів пам’ятати (≈ 38 слотів × 5 подій із запасом). */
export const MAX_KEYS = 500;
/** Реальна пауза між тактами, після якої переходи вважаються пропущеними. */
export const LATE_REAL_GAP_MS = 3_000;
/** Віртуальний стрибок за такт, більший за найшвидшу машину часу (×600 за 1 с) — це перемотка. */
export const LATE_VIRTUAL_GAP_MS = 10 * 60_000 + 1_000;
/** Відновлювати пропущене після перезавантаження лише в межах цього вікна. */
export const RESTORE_WINDOW_MS = 30 * 60_000;

export interface SchedulerData {
  eventsBySlot: readonly SlotGroup[];
  countriesByIso: ReadonlyMap<string, Pick<Country, 'popularity' | 'gender'>>;
  chainsByEventId: ReadonlyMap<string, StreamChain>;
}

/** Повертає `false`, якщо подію ніхто не отримав (немає підписників); `void` — невідомо (тести). */
export type Emit = <K extends UiEventType>(type: K, payload: UiEventMap[K]) => boolean | void;

export interface SchedulerDeps {
  data: SchedulerData;
  emit: Emit;
  storage?: Storage | null;
  /** Монотонний реальний час (для виявлення сну вкладки); за замовчуванням `performance.now()`. */
  realNow?: () => number;
  /** За якими подіями слота гість був присутній опівночі. */
  getPresence?: (eventIds: string[], at: Ms) => Record<string, PresenceSource>;
  /** За якими з подій у гостя є штамп (для `moment:rate-open`). */
  getStampedEventIds?: (eventIds: string[]) => string[];
  rate?: {
    /** Фокус у картці оцінки / гість змінює оцінку — закриття відкладається (WCAG 2.2.1). */
    isInteracting?: (eventIds: string[]) => boolean;
    /** Гість уже оцінив або закрив картку — `rate-close` емітує UI, не планувальник. */
    isClosed?: (eventIds: string[]) => boolean;
  };
  /** Контекст для `offerEligibility`; `null` — пропозиції не перевіряються. */
  getOfferContext?: (now: Ms) => OfferContext | null;
  /** Гість натиснув «Лишитися тут ›» і перейшов на сторінку країни. */
  stayedHere?: () => boolean;
}

export interface EngineScheduler {
  tick(now: Ms): void;
  /** Ключі, уже емітовані в цьому сеансі. */
  emittedKeys(): ReadonlySet<string>;
}

interface Due {
  at: Ms;
  order: number;
  run: (late: boolean) => void;
}

export function createEngineScheduler(deps: SchedulerDeps): EngineScheduler {
  const realNow = deps.realNow ?? (() => performance.now());
  const emitted = new Set<string>(readJson<string[]>(deps.storage, EMITTED_KEY) ?? []);
  const slots = airSlots(deps.data);
  let prev: Ms | null = null;
  let prevReal = 0;
  let restored = false;
  const pendingRateClose = new Map<string, { eventIds: string[]; closeAt: Ms; deferred: boolean }>();

  const restoredTick = readJson<{ now: number }>(deps.storage, LAST_TICK_KEY);

  function remember(key: string) {
    emitted.add(key);
    if (emitted.size > MAX_KEYS) {
      const first = emitted.values().next().value;
      if (first !== undefined) emitted.delete(first);
    }
    writeJson(deps.storage, EMITTED_KEY, [...emitted]);
  }

  function once<K extends UiEventType>(type: K, payload: UiEventMap[K] & { eventKey: string }) {
    if (emitted.has(payload.eventKey)) return;
    remember(payload.eventKey);
    const delivered = deps.emit(type, payload);
    // Пропозицію, яку ніхто не отримав (поверхня з плеєром ще не підписалась — перший такт після завантаження),
    // не позначаємо показаною: наступний такт спробує знову, поки вікно правил відкрите.
    if (delivered === false && type === 'offer:show') forget(payload.eventKey);
  }

  function forget(key: string) {
    emitted.delete(key);
    writeJson(deps.storage, EMITTED_KEY, [...emitted]);
  }

  function forgetAhead(now: Ms) {
    const suffixes: string[] = [];
    for (const slot of slots) {
      if (zonePassedHandover(now, slot.midnightMs)) continue;
      suffixes.push(`:${slot.midnightUtc}`, ...slot.events.map((e) => `:${e.id}`));
      pendingRateClose.delete(slot.midnightUtc);
    }
    let changed = false;
    for (const key of [...emitted]) {
      if (suffixes.some((sfx) => key.endsWith(sfx))) {
        emitted.delete(key);
        changed = true;
      }
    }
    if (changed) writeJson(deps.storage, EMITTED_KEY, [...emitted]);
  }

  function tick(now: Ms) {
    const real = realNow();
    if (prev === null) {
      // Перший такт: відновити пропущене після перезавантаження (у межах вікна), інакше без подій.
      if (restoredTick && restoredTick.now <= now && now - restoredTick.now <= RESTORE_WINDOW_MS) {
        prev = restoredTick.now;
        restored = true;
      } else {
        prev = now;
      }
      prevReal = real;
    }
    if (now < prev) {
      // Перемотка назад (машина часу): моменти, що знову попереду, мають спрацювати ще раз — забуваємо їхні
      // ключі (штамп, оцінка, перехід ефіру, пропозиції) для поясів, чий ефір ще не закінчився о `now`.
      forgetAhead(now);
      prev = now;
      prevReal = real;
      writeJson(deps.storage, LAST_TICK_KEY, { now });
      return;
    }

    const late = restored || real - prevReal > LATE_REAL_GAP_MS || now - prev > LATE_VIRTUAL_GAP_MS;
    restored = false;
    const from = prev;
    const due: Due[] = [];
    const inWindow = (at: Ms) => at > from && at <= now;

    slots.forEach((slot, i) => {
      const tl = momentTimeline({ id: slot.midnightUtc, midnightUtc: slot.midnightUtc, midnightMs: slot.midnightMs });
      const slotKey = slot.midnightUtc;
      const eventIds = slot.events.map((e) => e.id);

      if (inWindow(tl.stampAt)) {
        due.push({
          at: tl.stampAt,
          order: 0,
          run: (isLate) => {
            const presence = deps.getPresence?.(eventIds, tl.stampAt) ?? {};
            const presentEventIds = eventIds.filter((id) => presence[id] !== undefined);
            const presenceSources: Record<string, PresenceSource> = {};
            for (const id of presentEventIds) presenceSources[id] = presence[id]!;
            const isos = [...new Set(slot.events.map((e) => e.countryIso))];
            const air = pickSlotEvent(tl.stampAt, slot.events, deps.data.countriesByIso, deps.data.chainsByEventId);
            const payload: UiEventMap['moment:stamp'] = {
              eventKey: `stamp:${slotKey}`,
              at: tl.stampAt,
              firedAt: now,
              slotMidnightUtc: slotKey,
              eventIds,
              presentEventIds,
              presenceSources,
              countries: isos.map((iso) => ({ iso, gender: deps.data.countriesByIso.get(iso)?.gender ?? null })),
              announce: { cityId: air?.event.cityId ?? '', text: 'midnight-stamp-ready' },
            };
            if (isLate) payload.late = true;
            once('moment:stamp', payload);
          },
        });
      }

      if (inWindow(tl.rateOpenAt)) {
        due.push({
          at: tl.rateOpenAt,
          order: 1,
          run: (isLate) => {
            const stamped = deps.getStampedEventIds?.(eventIds) ?? [];
            const key = `rate-open:${slotKey}`;
            if (stamped.length === 0) {
              remember(key); // гість без штампа — оцінки немає
              return;
            }
            const payload: UiEventMap['moment:rate-open'] = {
              eventKey: key,
              at: tl.rateOpenAt,
              eventIds: stamped,
              closesAt: tl.rateCloseAt,
            };
            if (isLate) payload.late = true;
            if (!emitted.has(key)) pendingRateClose.set(slotKey, { eventIds: stamped, closeAt: tl.rateCloseAt, deferred: false });
            once('moment:rate-open', payload);
          },
        });
      }

      const next = slots[i + 1];
      if (next && inWindow(tl.handoverSoonAt)) {
        due.push({
          at: tl.handoverSoonAt,
          order: 3,
          run: (isLate) => {
            const fromEv = pickSlotEvent(tl.handoverSoonAt, slot.events, deps.data.countriesByIso, deps.data.chainsByEventId);
            const toEv = pickSlotEvent(tl.handoverSoonAt, next.events, deps.data.countriesByIso, deps.data.chainsByEventId);
            if (!fromEv || !toEv) return;
            const payload: UiEventMap['air:handover-soon'] = {
              eventKey: `handover-soon:${fromEv.event.id}`,
              at: tl.handoverSoonAt,
              fromEventId: fromEv.event.id,
              toEventId: toEv.event.id,
              remainingMs: Math.max(0, tl.handoverAt - now),
              handoverAt: tl.handoverAt,
            };
            if (isLate) payload.late = true;
            once('air:handover-soon', payload);
          },
        });
      }
      if (inWindow(tl.handoverAt)) {
        due.push({
          at: tl.handoverAt,
          order: 4,
          run: (isLate) => {
            const fromEv = pickSlotEvent(tl.handoverAt - 1, slot.events, deps.data.countriesByIso, deps.data.chainsByEventId);
            const air = currentAirEvent(tl.handoverAt, deps.data, deps.data.chainsByEventId);
            if (!fromEv) return;
            const payload: UiEventMap['air:handover'] = {
              eventKey: `handover:${fromEv.event.id}`,
              at: tl.handoverAt,
              fromEventId: fromEv.event.id,
              toEventId: air.event?.id ?? fromEv.event.id,
              viewChanged: air.view,
              stayedHere: deps.stayedHere?.() ?? false,
              reason: 'timer',
            };
            if (isLate) payload.late = true;
            once('air:handover', payload);
          },
        });
      }
    });

    due.sort((a, b) => a.at - b.at || a.order - b.order);
    for (const d of due) d.run(late);

    // Закриття оцінки за часом (відкладається, поки гість взаємодіє).
    for (const [slotKey, p] of pendingRateClose) {
      if (now < p.closeAt) continue;
      const key = `rate-close:${slotKey}`;
      if (emitted.has(key) || deps.rate?.isClosed?.(p.eventIds)) {
        pendingRateClose.delete(slotKey);
        remember(key);
        continue;
      }
      if (deps.rate?.isInteracting?.(p.eventIds)) {
        p.deferred = true;
        continue;
      }
      pendingRateClose.delete(slotKey);
      const payload: UiEventMap['moment:rate-close'] = {
        eventKey: key,
        at: p.closeAt,
        eventIds: p.eventIds,
        reason: 'timeout',
      };
      if (p.deferred) payload.deferredMs = now - p.closeAt;
      if (late) payload.late = true;
      once('moment:rate-close', payload);
    }

    // Пропозиції: не раніше закриття оцінки й не пізніше ніж за 10 хв до наступної півночі (двигун).
    const ctx = deps.getOfferContext?.(now);
    if (ctx && ctx.lastEvent) {
      const d = offerEligibility(now, ctx);
      if (d.show) {
        once('offer:show', {
          eventKey: `offer:${d.show}:${ctx.lastEvent.id}`,
          at: now,
          kind: d.show,
          triggerEventId: ctx.lastEvent.id,
          stampCount: ctx.stamps.length,
          neutralizeSound: true,
        });
      }
    }

    prev = now;
    prevReal = real;
    writeJson(deps.storage, LAST_TICK_KEY, { now });
  }

  return { tick, emittedKeys: () => emitted };
}

function readJson<T>(storage: Storage | null | undefined, key: string): T | null {
  try {
    const raw = storage?.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(storage: Storage | null | undefined, key: string, value: unknown): void {
  try {
    storage?.setItem(key, JSON.stringify(value));
  } catch {
    // без збереження — лише дедуплікація в пам’яті
  }
}
