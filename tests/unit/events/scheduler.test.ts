import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import type { PresenceSource } from '@/lib/data/types';
import { clearAllHandlers, emit, on } from '@/lib/events/bus';
import { createEngineScheduler, type SchedulerDeps } from '@/lib/events/engineScheduler';
import type { UiEventMap, UiEventType } from '@/lib/events/types';
import { LONDON_MIDNIGHT, MIN, miniSchedule, PARIS_MIDNIGHT, SEC } from '../fixtures/data';

const { schedule, countries, streams } = miniSchedule();
const data = buildDataset(schedule, countries, streams);

type Log = { type: UiEventType; payload: UiEventMap[UiEventType] }[];

function setup(over: Partial<SchedulerDeps> = {}) {
  const log: Log = [];
  const real = { t: 0 };
  const s = createEngineScheduler({
    data,
    emit: (type, payload) => {
      log.push({ type, payload });
    },
    storage: sessionStorage,
    realNow: () => real.t,
    ...over,
  });
  /** Такти раз на (реальну) секунду від `from` до `to` з кроком `step` віртуального часу. */
  const run = (from: number, to: number, step = SEC) => {
    for (let t = from; t <= to; t += step) {
      real.t += 1_000;
      s.tick(t);
    }
  };
  return { s, log, real, run };
}

const ofType = <K extends UiEventType>(log: Log, type: K) =>
  log.filter((e) => e.type === type).map((e) => e.payload as UiEventMap[K]);

afterEach(() => clearAllHandlers());

describe('шина подій', () => {
  it('on/emit типізовано, порядок підписки, відписка', () => {
    const calls: string[] = [];
    const off1 = on('air:handover', (p) => calls.push(`1:${p.toEventId}`));
    on('air:handover', (p) => calls.push(`2:${p.toEventId}`));
    const payload: UiEventMap['air:handover'] = {
      eventKey: 'handover:a',
      at: 0,
      fromEventId: 'a',
      toEventId: 'b',
      viewChanged: 'stream',
      stayedHere: false,
      reason: 'timer',
    };
    emit('air:handover', payload);
    off1();
    emit('air:handover', payload);
    expect(calls).toEqual(['1:b', '2:b', '2:b']);
  });

  it('помилка одного обробника не зупиняє інших', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const ok = vi.fn();
    on('offer:show', () => {
      throw new Error('boom');
    });
    on('offer:show', ok);
    emit('offer:show', {
      eventKey: 'k',
      at: 0,
      kind: 'pass-offer',
      triggerEventId: 'e',
      stampCount: 3,
      neutralizeSound: true,
    });
    expect(ok).toHaveBeenCalledOnce();
    spy.mockRestore();
  });
});

describe('EngineScheduler', () => {
  it('опівночі +15 с подія moment:stamp одна на слот', () => {
    const { log, run } = setup({
      getPresence: (ids): Record<string, PresenceSource> =>
        ids.includes('evt_london_2027') ? { evt_london_2027: 'air' } : {},
    });
    run(LONDON_MIDNIGHT - 5 * SEC, LONDON_MIDNIGHT + 30 * SEC);
    const stamps = ofType(log, 'moment:stamp');
    expect(stamps).toHaveLength(1);
    const st = stamps[0]!;
    expect(st).toMatchObject({
      eventKey: 'stamp:2027-01-01T00:00:00Z',
      at: LONDON_MIDNIGHT + 15 * SEC,
      firedAt: LONDON_MIDNIGHT + 15 * SEC,
      slotMidnightUtc: '2027-01-01T00:00:00Z',
      presentEventIds: ['evt_london_2027'],
      presenceSources: { evt_london_2027: 'air' },
      announce: { cityId: 'london', text: 'midnight-stamp-ready' },
    });
    expect(st.late).toBeUndefined();
    expect(st.eventIds.sort()).toEqual(['evt_lisbon_2027', 'evt_london_2027']); // лише головні святкування
    expect(st.countries.map((c) => c.iso).sort()).toEqual(['GB', 'PT']);
  });

  it('повторне відкриття вкладки (новий планувальник того ж сеансу) не повторює подію', () => {
    const a = setup();
    a.run(LONDON_MIDNIGHT + 10 * SEC, LONDON_MIDNIGHT + 20 * SEC);
    expect(ofType(a.log, 'moment:stamp')).toHaveLength(1);
    const b = setup();
    b.run(LONDON_MIDNIGHT + 10 * SEC, LONDON_MIDNIGHT + 20 * SEC);
    expect(ofType(b.log, 'moment:stamp')).toHaveLength(0);
  });

  it('перемотка назад (машина часу): момент, що знову попереду, спрацьовує ще раз', () => {
    const { log, s, real } = setup();
    real.t = 1_000;
    s.tick(LONDON_MIDNIGHT + 10 * SEC);
    real.t = 2_000;
    s.tick(LONDON_MIDNIGHT + 16 * SEC);
    real.t = 3_000;
    s.tick(LONDON_MIDNIGHT); // машина часу: назад
    real.t = 4_000;
    s.tick(LONDON_MIDNIGHT + 16 * SEC);
    expect(ofType(log, 'moment:stamp')).toHaveLength(2);
  });

  it('перемотка назад у межах ефіру не повторює моментів, що вже позаду', () => {
    const { log, s, real } = setup();
    real.t = 1_000;
    s.tick(LONDON_MIDNIGHT + 10 * SEC);
    real.t = 2_000;
    s.tick(LONDON_MIDNIGHT + 20 * MIN);
    real.t = 3_000;
    s.tick(LONDON_MIDNIGHT + 16 * MIN); // ефір Лондона вже закінчився — нічого не забуваємо
    real.t = 4_000;
    s.tick(LONDON_MIDNIGHT + 17 * MIN);
    expect(ofType(log, 'moment:stamp')).toHaveLength(1);
  });

  it('запізніла подія (вкладка спала) — один раз з late: true, без оголошення', () => {
    const { log, s, real } = setup();
    real.t = 1_000;
    s.tick(LONDON_MIDNIGHT);
    real.t = 1_000 + 3 * 60_000; // 3 хв без тактів
    s.tick(LONDON_MIDNIGHT + 3 * MIN);
    const stamps = ofType(log, 'moment:stamp');
    expect(stamps).toHaveLength(1);
    expect(stamps[0]!.late).toBe(true);
    expect(stamps[0]!.firedAt).toBe(LONDON_MIDNIGHT + 3 * MIN);
    expect(stamps[0]!.at).toBe(LONDON_MIDNIGHT + 15 * SEC);
  });

  it('перший такт без попереднього стану не емітує минулих подій', () => {
    const { log, s } = setup();
    s.tick(LONDON_MIDNIGHT + 5 * MIN);
    expect(log).toHaveLength(0);
  });

  it('оцінка: rate-open о +5 хв лише зі штампом; rate-close після +8 хв, відкладається при взаємодії', () => {
    let interacting = false;
    const { log, run } = setup({
      getStampedEventIds: (ids) => ids.filter((id) => id === 'evt_london_2027'),
      rate: { isInteracting: () => interacting },
    });
    run(LONDON_MIDNIGHT + 290 * SEC, LONDON_MIDNIGHT + 305 * SEC);
    expect(ofType(log, 'moment:rate-open')).toEqual([
      {
        eventKey: 'rate-open:2027-01-01T00:00:00Z',
        at: LONDON_MIDNIGHT + 5 * MIN,
        eventIds: ['evt_london_2027'],
        closesAt: LONDON_MIDNIGHT + 8 * MIN,
      },
    ]);
    interacting = true;
    run(LONDON_MIDNIGHT + 8 * MIN - 2 * SEC, LONDON_MIDNIGHT + 8 * MIN + 10 * SEC);
    expect(ofType(log, 'moment:rate-close')).toHaveLength(0);
    interacting = false;
    run(LONDON_MIDNIGHT + 8 * MIN + 11 * SEC, LONDON_MIDNIGHT + 8 * MIN + 11 * SEC);
    const close = ofType(log, 'moment:rate-close');
    expect(close).toHaveLength(1);
    expect(close[0]).toMatchObject({
      reason: 'timeout',
      at: LONDON_MIDNIGHT + 8 * MIN,
      deferredMs: 11 * SEC,
    });
  });

  it('без штампа оцінки немає', () => {
    const { log, run } = setup({ getStampedEventIds: () => [] });
    run(LONDON_MIDNIGHT + 290 * SEC, LONDON_MIDNIGHT + 9 * MIN, 10 * SEC);
    expect(ofType(log, 'moment:rate-open')).toHaveLength(0);
    expect(ofType(log, 'moment:rate-close')).toHaveLength(0);
  });

  it('air:handover-soon на +14 хв і air:handover на +15 хв, у порядку', () => {
    const { log, run } = setup();
    run(PARIS_MIDNIGHT + 13 * MIN + 55 * SEC, PARIS_MIDNIGHT + 15 * MIN + 5 * SEC);
    const soon = ofType(log, 'air:handover-soon');
    const ho = ofType(log, 'air:handover');
    expect(soon).toEqual([
      {
        eventKey: 'handover-soon:evt_paris_2027',
        at: PARIS_MIDNIGHT + 14 * MIN,
        fromEventId: 'evt_paris_2027',
        toEventId: 'evt_london_2027',
        remainingMs: 60 * SEC,
        handoverAt: PARIS_MIDNIGHT + 15 * MIN,
      },
    ]);
    expect(ho).toEqual([
      {
        eventKey: 'handover:evt_paris_2027',
        at: PARIS_MIDNIGHT + 15 * MIN,
        fromEventId: 'evt_paris_2027',
        toEventId: 'evt_london_2027',
        viewChanged: 'stream',
        stayedHere: false,
        reason: 'timer',
      },
    ]);
    const order = log.map((e) => e.type).filter((t) => t.startsWith('air:'));
    expect(order).toEqual(['air:handover-soon', 'air:handover']);
  });

  it('стрибок машини часу на годину — пропущені події одноразово з late, у порядку часу', () => {
    const { log, s, real } = setup();
    real.t = 1_000;
    s.tick(PARIS_MIDNIGHT - MIN);
    real.t = 2_000;
    s.tick(LONDON_MIDNIGHT + 30 * SEC);
    const types = log.map((e) => [
      e.type,
      (e.payload as { at: number }).at,
      (e.payload as { late?: boolean }).late,
    ]);
    expect(types).toEqual([
      ['moment:stamp', PARIS_MIDNIGHT + 15 * SEC, true],
      ['air:handover-soon', PARIS_MIDNIGHT + 14 * MIN, true],
      ['air:handover', PARIS_MIDNIGHT + 15 * MIN, true],
      ['moment:stamp', LONDON_MIDNIGHT + 15 * SEC, true],
    ]);
  });

  it('offer:show — коли двигун дозволяє, один раз на ключ', () => {
    const { log, run } = setup({
      getOfferContext: () => ({
        stamps: [
          {
            eventId: 'evt_paris_2027',
            grantedAt: 0,
            presenceSource: 'air',
            illustrationId: 'x',
            cityName: 'Париж',
            countryIso: 'FR',
          },
          {
            eventId: 'evt_london_2027',
            grantedAt: 0,
            presenceSource: 'air',
            illustrationId: 'x',
            cityName: 'Лондон',
            countryIso: 'GB',
          },
        ],
        lastEvent: data.eventsById.get('evt_london_2027')!,
        nextEvent: data.eventsById.get('evt_rio_2027')!,
        hasPass: false,
        rate: 'closed',
        offers: { nightId: '2026-27', history: [], visible: null },
        ui: { overlayOpen: false, composerFocused: false },
      }),
    });
    run(LONDON_MIDNIGHT + 5 * MIN - 2 * SEC, LONDON_MIDNIGHT + 5 * MIN + 5 * SEC);
    expect(ofType(log, 'offer:show')).toEqual([
      {
        eventKey: 'offer:pass-offer:evt_london_2027',
        at: LONDON_MIDNIGHT + 5 * MIN,
        kind: 'pass-offer',
        triggerEventId: 'evt_london_2027',
        stampCount: 2,
        neutralizeSound: true,
      },
    ]);
  });

  it('offer:show без підписників (перший такт після завантаження) не позначається показаним і повторюється', () => {
    let delivered = false;
    const got: string[] = [];
    const { run } = setup({
      emit: (type, payload) => {
        if (type !== 'offer:show') return true;
        if (!delivered) return false;
        got.push((payload as UiEventMap['offer:show']).eventKey);
        return true;
      },
      getOfferContext: () => ({
        stamps: [
          {
            eventId: 'evt_paris_2027',
            grantedAt: 0,
            presenceSource: 'air',
            illustrationId: 'x',
            cityName: 'Париж',
            countryIso: 'FR',
          },
          {
            eventId: 'evt_london_2027',
            grantedAt: 0,
            presenceSource: 'air',
            illustrationId: 'x',
            cityName: 'Лондон',
            countryIso: 'GB',
          },
        ],
        lastEvent: data.eventsById.get('evt_london_2027')!,
        nextEvent: data.eventsById.get('evt_rio_2027')!,
        hasPass: false,
        rate: 'closed',
        offers: { nightId: '2026-27', history: [], visible: null },
        ui: { overlayOpen: false, composerFocused: false },
      }),
    });
    run(LONDON_MIDNIGHT + 6 * MIN, LONDON_MIDNIGHT + 6 * MIN + 2 * SEC);
    expect(got).toEqual([]);
    delivered = true;
    run(LONDON_MIDNIGHT + 6 * MIN + 3 * SEC, LONDON_MIDNIGHT + 6 * MIN + 5 * SEC);
    expect(got).toEqual(['offer:pass-offer:evt_london_2027']);
  });
});
