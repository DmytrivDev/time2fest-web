import { describe, expect, it } from 'vitest';
import { eventStatus } from '@/lib/engine/eventStatus';
import { chainStatus, firstPlayableSource, sourceStatus } from '@/lib/engine/sourceStatus';
import { zoneState } from '@/lib/engine/zoneState';
import { event, LONDON_MIDNIGHT, MIN, PARIS_MIDNIGHT, RIO_MIDNIGHT, source } from '../fixtures/data';

describe('eventStatus', () => {
  const e = event('london', LONDON_MIDNIGHT);
  it.each([
    [-15 * MIN - 1, 'soon'],
    [-15 * MIN, 'live'],
    [0, 'live'],
    [15 * MIN - 1, 'live'],
    [15 * MIN, 'ended'],
    [30 * MIN - 1, 'ended'],
    [30 * MIN, 'recording'],
    [5 * 60 * MIN, 'recording'],
  ])('t = %d мс → %s', (t, expected) => {
    expect(eventStatus(LONDON_MIDNIGHT + t, e)).toBe(expected);
  });
});

describe('zoneState', () => {
  const zones = [
    { id: 'utc+0100', midnightMs: PARIS_MIDNIGHT },
    { id: 'utc+0000', midnightMs: LONDON_MIDNIGHT },
    { id: 'utc-0300', midnightMs: RIO_MIDNIGHT },
  ];
  it('past | live | next | future', () => {
    const now = PARIS_MIDNIGHT + 20 * MIN; // Париж минув, ефір на Лондоні
    expect(zones.map((z) => zoneState(now, z, zones))).toEqual(['past', 'live', 'next']);
    const early = PARIS_MIDNIGHT - 60 * MIN;
    expect(zones.map((z) => zoneState(early, z, zones))).toEqual(['live', 'next', 'future']);
    const end = RIO_MIDNIGHT + 15 * MIN;
    expect(zones.map((z) => zoneState(end, z, zones))).toEqual(['past', 'past', 'past']);
  });
});

describe('sourceStatus', () => {
  const now = LONDON_MIDNIGHT;
  it('startsAt > now → expected', () => {
    const s = source('a', { status: 'expected', startsAt: new Date(now + MIN).toISOString(), isLive: false });
    expect(sourceStatus(s, now)).toBe('expected');
  });
  it('після startsAt → live без перезавантаження', () => {
    const s = source('a', { status: 'expected', startsAt: new Date(now - MIN).toISOString(), isLive: false });
    expect(sourceStatus(s, now)).toBe('live');
  });
  it('live без embeddable або isLive → none (пропускається)', () => {
    expect(sourceStatus(source('a', { embeddable: false }), now)).toBe('none');
    expect(sourceStatus(source('a', { isLive: false }), now)).toBe('none');
    expect(sourceStatus(source('a'), now)).toBe('live');
  });
  it('possible лишається possible', () => {
    expect(sourceStatus(source('a', { status: 'possible', isLive: false }), now)).toBe('possible');
  });
  it('ланцюжок: порожній → none; найкращий статус; перше придатне за order', () => {
    expect(chainStatus(undefined, now)).toBe('none');
    expect(chainStatus({ eventId: 'e', sources: [] }, now)).toBe('none');
    const chain = {
      eventId: 'e',
      sources: [
        source('x', { order: 0, embeddable: false }),
        source('y', { order: 1, status: 'expected', startsAt: new Date(now + MIN).toISOString() }),
        source('z', { order: 2 }),
      ],
    };
    expect(chainStatus(chain, now)).toBe('live');
    expect(firstPlayableSource(chain, now)!.id).toBe('z');
  });
});
