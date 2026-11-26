import { describe, expect, it } from 'vitest';
import { GRANT_KINDS, PASSPORT_REASONS, PRESENCE_SOURCES } from '../src/passport';
import { isBeatResponse, isStamp, isStampEvent, isStampList } from '../src/passportGuard';
import {
  presenceBeatBody,
  presenceBeatResponse,
  presenceDowntimeAdd,
  presenceDowntimeDoor,
  presenceFaultDoor,
  presenceHealthDoor,
  presenceTickDoor,
  stampClaimBody,
  stampEventSchema,
  stampListSchema,
  stampSchema,
} from '../src/schemas';

const stamp = { eventId: 'e1', grantedAt: 1000, presenceSource: 'room', illustrationId: 'i', cityName: 'Kyiv', countryIso: 'UA' };

// SPEC-14 AC-58 / AC-1 / AC-23 / AC-39 / NFR-4
describe('passport wire schemas', () => {
  it('pins vocabularies', () => {
    expect([...PASSPORT_REASONS]).toEqual(['claim-closed', 'no-presence', 'unknown-event']);
    expect([...PRESENCE_SOURCES]).toEqual(['country', 'air', 'room', 'tv']);
    expect([...GRANT_KINDS]).toEqual(['presence', 'downtime', 'old-moment']);
  });

  it('beat body is strict: no playerState, 1..8 ids of at most 64, known source', () => {
    expect(presenceBeatBody.safeParse({ eventIds: ['a'], source: 'tv', openedAt: 5 }).success).toBe(true);
    expect(presenceBeatBody.safeParse({ eventIds: ['a'], source: 'tv', playerState: 'playing' }).success).toBe(false);
    expect(presenceBeatBody.safeParse({ eventIds: Array(9).fill('a'), source: 'tv' }).success).toBe(false);
    expect(presenceBeatBody.safeParse({ eventIds: Array(8).fill('a'), source: 'tv' }).success).toBe(true);
    expect(presenceBeatBody.safeParse({ eventIds: [], source: 'tv' }).success).toBe(false);
    expect(presenceBeatBody.safeParse({ eventIds: ['x'.repeat(65)], source: 'tv' }).success).toBe(false);
    expect(presenceBeatBody.safeParse({ eventIds: ['a'], source: 'youtube' }).success).toBe(false);
  });

  it('claim body and responses', () => {
    expect(stampClaimBody.safeParse({ eventId: 'a', source: 'air', at: 1 }).success).toBe(true);
    expect(stampClaimBody.safeParse({ eventId: 'a', source: 'air', at: -1 }).success).toBe(false);
    expect(stampClaimBody.safeParse({ eventId: 'a', source: 'air', at: 1, x: 1 }).success).toBe(false);
    expect(presenceBeatResponse.safeParse({ nextBeatMs: null }).success).toBe(true);
    expect(presenceBeatResponse.safeParse({ nextBeatMs: 20000 }).success).toBe(true);
    expect(presenceBeatResponse.safeParse({}).success).toBe(false);
  });

  it('door and admin bodies', () => {
    expect(presenceFaultDoor.safeParse({ fastStore: 'down', beatErrorRate: 0.02 }).success).toBe(true);
    expect(presenceFaultDoor.safeParse({ beatErrorRate: 2 }).success).toBe(false);
    expect(presenceDowntimeDoor.safeParse({ kind: 'manual', eventId: 'e', reason: 'r' }).success).toBe(true);
    expect(presenceDowntimeDoor.safeParse({ kind: 'manual', from: 1, to: 2, reason: 'r' }).success).toBe(true);
    expect(presenceDowntimeDoor.safeParse({ kind: 'edge-region', region: 'eu', from: 1, to: 2 }).success).toBe(true);
    expect(presenceDowntimeDoor.safeParse({ kind: 'manual', from: 1, to: 2, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(presenceTickDoor.safeParse({}).success).toBe(true);
    expect(presenceTickDoor.safeParse({ a: 1 }).success).toBe(false);
    expect(presenceHealthDoor.safeParse({ eventId: 'e' }).success).toBe(true);
    expect(presenceDowntimeAdd.safeParse({ from: 1, to: 2, reason: 'r' }).success).toBe(true);
    expect(presenceDowntimeAdd.safeParse({ from: 1, to: 2 }).success).toBe(false);
  });

  it('guards agree with zod on valid and invalid envelopes', () => {
    const goodEvents = [
      { type: 'stamp', id: 'a', data: { kind: 'granted', stamp } },
      { type: 'stamp', id: 'a', data: { kind: 'snapshot', stamps: [stamp] } },
      { type: 'stamp', id: 'a', data: { kind: 'snapshot', stamps: [] } },
    ];
    const badEvents = [
      { type: 'stamp', id: '', data: { kind: 'granted', stamp } },
      { type: 'stamp', id: 'a', data: { kind: 'granted', stamp: { ...stamp, presenceSource: 'x' } } },
      { type: 'stamp', id: 'a', data: { kind: 'granted', stamp: { ...stamp, extra: 1 } } },
      { type: 'stamp', id: 'a', data: { kind: 'other' } },
      { type: 'profile', id: 'a', data: { kind: 'snapshot', stamps: [] } },
      { type: 'stamp', id: 'a', data: { kind: 'snapshot', stamps: [{ eventId: 'e' }] } },
      null,
      [],
    ];
    for (const e of [...goodEvents, ...badEvents]) expect(isStampEvent(e)).toBe(stampEventSchema.safeParse(e).success);
    expect(goodEvents.every(isStampEvent)).toBe(true);
    expect(badEvents.some(isStampEvent)).toBe(false);

    for (const s of [stamp, { ...stamp, grantedAt: 1.5 }, { ...stamp, cityName: '' }, 3]) expect(isStamp(s)).toBe(stampSchema.safeParse(s).success);
    for (const l of [[stamp], [], [{}], 'x']) expect(isStampList(l)).toBe(stampListSchema.safeParse(l).success);
    for (const b of [{ nextBeatMs: null }, { nextBeatMs: 5 }, { nextBeatMs: -1 }, {}, { nextBeatMs: 1, x: 1 }])
      expect(isBeatResponse(b)).toBe(presenceBeatResponse.safeParse(b).success);
  });
});
