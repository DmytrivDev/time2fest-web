import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import type { StreamChain } from '@/lib/data/types';
import { CELEBRATION_TAIL } from '@/lib/engine/celebration';
import { currentAirEvent } from '@/lib/engine/currentAirEvent';
import { country, event, LONDON_MIDNIGHT, MIN, miniSchedule, PARIS_MIDNIGHT, RIO_MIDNIGHT, SEC, source } from '../fixtures/data';

const HOUR = 60 * MIN;
const { schedule, countries, streams } = miniSchedule();
const data = buildDataset(schedule, countries, streams);

describe('currentAirEvent: слоти', () => {
  it('до першого слота — перший слот', () => {
    const air = currentAirEvent(PARIS_MIDNIGHT - 3 * 60 * MIN, data, data.chainsByEventId);
    expect(air.slotMidnightUtc).toBe(new Date(PARIS_MIDNIGHT).toISOString().replace('.000Z', 'Z'));
    expect(air.event!.zoneId).toBe('utc+0100');
    expect(air.handoverAt).toBe(PARIS_MIDNIGHT + 15 * MIN);
  });

  it('слот живе до midnight + 15 хв і далі одразу переходить до наступного, навіть якщо до нього година', () => {
    const last = currentAirEvent(PARIS_MIDNIGHT + 15 * MIN - 1, data, data.chainsByEventId);
    expect(last.event!.zoneId).toBe('utc+0100');
    const next = currentAirEvent(PARIS_MIDNIGHT + 15 * MIN, data, data.chainsByEventId);
    expect(next.event!.id).toBe('evt_london_2027');
    expect(next.event!.status).toBe('soon'); // до півночі Лондона ще 45 хв
    expect(next.event!.t).toBe(-45 * 60);
  });

  it('nextEvent — подія наступного слота', () => {
    const air = currentAirEvent(LONDON_MIDNIGHT, data, data.chainsByEventId);
    expect(air.event!.id).toBe('evt_london_2027');
    expect(air.nextEvent!.id).toBe('evt_rio_2027');
  });

  it('останній слот лишається в ефірі після +15 хв — переходити нікуди (рішення 2026-11-14)', () => {
    for (const now of [RIO_MIDNIGHT + 15 * MIN - SEC, RIO_MIDNIGHT + 15 * MIN, RIO_MIDNIGHT + 15 * MIN + SEC, RIO_MIDNIGHT + HOUR]) {
      const air = currentAirEvent(now, data, data.chainsByEventId);
      expect(air.event!.id).toBe('evt_rio_2027');
      expect(air.view).not.toBe('festival-over');
      expect(air.nextEvent).toBeNull();
    }
    expect(currentAirEvent(RIO_MIDNIGHT + 15 * MIN, data, data.chainsByEventId).handoverAt).toBe(RIO_MIDNIGHT + 15 * MIN);
  });

  it('festival-over — лише після останньої півночі + 2 год (±1 с)', () => {
    const inside = currentAirEvent(RIO_MIDNIGHT + CELEBRATION_TAIL - SEC, data, data.chainsByEventId);
    expect(inside.event!.id).toBe('evt_rio_2027');
    expect(currentAirEvent(RIO_MIDNIGHT + CELEBRATION_TAIL, data, data.chainsByEventId).event!.id).toBe('evt_rio_2027');
    const air = currentAirEvent(RIO_MIDNIGHT + CELEBRATION_TAIL + SEC, data, data.chainsByEventId);
    expect(air).toMatchObject({ view: 'festival-over', event: null, nextEvent: null, source: null, handoverAt: null });
  });

  it('передача між НЕ останніми слотами — як і раніше о +15 хв', () => {
    expect(currentAirEvent(LONDON_MIDNIGHT + 15 * MIN - SEC, data, data.chainsByEventId).event!.id).toBe('evt_london_2027');
    expect(currentAirEvent(LONDON_MIDNIGHT + 15 * MIN, data, data.chainsByEventId).event!.id).toBe('evt_rio_2027');
  });
});

describe('currentAirEvent: вибір події слота', () => {
  it('події без isMainCelebration не беруть участь (навіть з джерелом і вищою популярністю)', () => {
    const chains = new Map<string, StreamChain>([
      ['evt_manchester_2027', { eventId: 'evt_manchester_2027', sources: [source('m1')] }],
    ]);
    const air = currentAirEvent(LONDON_MIDNIGHT - MIN, data, chains);
    expect(air.event!.id).not.toBe('evt_manchester_2027');
  });

  it('спершу подія з придатним джерелом, навіть якщо її popularity нижча', () => {
    const chains = new Map<string, StreamChain>([
      ['evt_berlin_2027', { eventId: 'evt_berlin_2027', sources: [source('b1')] }],
    ]);
    const air = currentAirEvent(PARIS_MIDNIGHT - MIN, data, chains);
    expect(air.event!.id).toBe('evt_berlin_2027'); // Париж популярніший, але без джерела
    expect(air.view).toBe('stream');
    expect(air.source!.id).toBe('b1');
  });

  it('без джерел — найбільший popularity і сцена відліку', () => {
    const air = currentAirEvent(PARIS_MIDNIGHT - MIN, data, new Map());
    expect(air.event!.id).toBe('evt_paris_2027');
    expect(air.view).toBe('countdown-scene');
    expect(air.source).toBeNull();
  });

  it('тай-брейк Country.popularity, потім id', () => {
    const a = event('aaa', PARIS_MIDNIGHT, { countryIso: 'XA', popularity: 70 });
    const b = event('bbb', PARIS_MIDNIGHT, { countryIso: 'XB', popularity: 70 });
    const c = event('ccc', PARIS_MIDNIGHT, { countryIso: 'XC', popularity: 70 });
    const slots = [{ midnightMs: PARIS_MIDNIGHT, midnightUtc: a.midnightUtc, zoneId: a.zoneId, events: [c, b, a] }];
    const byCountry = new Map([
      ['XA', country('XA', { popularity: 10 })],
      ['XB', country('XB', { popularity: 90 })],
      ['XC', country('XC', { popularity: 90 })],
    ]);
    const air = currentAirEvent(PARIS_MIDNIGHT - MIN, { eventsBySlot: slots, countriesByIso: byCountry }, new Map());
    expect(air.event!.id).toBe('evt_bbb_2027');
  });

  it('пропускає джерела embeddable=false і live без isLive; бере наступне за order', () => {
    const chains = new Map<string, StreamChain>([
      [
        'evt_london_2027',
        {
          eventId: 'evt_london_2027',
          sources: [
            source('l0', { order: 0, embeddable: false }),
            source('l1', { order: 1, isLive: false }),
            source('l2', { order: 2 }),
          ],
        },
      ],
    ]);
    const air = currentAirEvent(LONDON_MIDNIGHT - MIN, data, chains);
    expect(air.source!.id).toBe('l2');
  });

  it('expected-джерело: до startsAt — сцена очікування, після — stream без перезавантаження', () => {
    const startsAt = new Date(LONDON_MIDNIGHT - 30 * MIN).toISOString();
    const chains = new Map<string, StreamChain>([
      [
        'evt_london_2027',
        { eventId: 'evt_london_2027', sources: [source('l0', { status: 'expected', startsAt, isLive: false })] },
      ],
    ]);
    const before = currentAirEvent(LONDON_MIDNIGHT - 40 * MIN, data, chains);
    expect(before.event!.id).toBe('evt_london_2027');
    expect(before.view).toBe('expected-scene');
    expect(before.source).toBeNull();
    const after = currentAirEvent(LONDON_MIDNIGHT - 30 * MIN + SEC, data, chains);
    expect(after.view).toBe('stream');
    expect(after.source!.id).toBe('l0');
  });

  it('статус події ефіру: live з −15 хв', () => {
    expect(currentAirEvent(LONDON_MIDNIGHT - 15 * MIN, data, data.chainsByEventId).event!.status).toBe('live');
    expect(currentAirEvent(LONDON_MIDNIGHT - 15 * MIN - 1, data, data.chainsByEventId).event!.status).toBe('soon');
  });
});
