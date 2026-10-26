import { describe, expect, it } from 'vitest';
import { NEXT_EVENT_JUMP } from '@/lib/engine/config';
import { currentAirEvent } from '@/lib/engine/currentAirEvent';
import { getData } from '@/lib/data/load';
import { computeJumps, JUMP_IDS } from '@/lib/time/jumps';

const MIN = 60_000;
const ev = (midnightMs: number) => ({ midnightMs }) as never;

describe('computeJumps', () => {
  it('рахує стрибки від півночі події ефіру', () => {
    const mid = Date.parse('2026-12-31T22:00:00Z');
    const j = computeJumps({ event: ev(mid), nextEvent: null });
    expect(j.minus15m).toBe(mid - 15 * MIN);
    expect(j.minus1m).toBe(mid - MIN);
    expect(j.midnight).toBe(mid);
    expect(j.plus14m).toBe(mid + 14 * MIN);
  });

  it('«наступна подія» = північ наступного слота − 22 хв', () => {
    const mid = Date.parse('2026-12-31T22:00:00Z');
    const next = Date.parse('2026-12-31T23:00:00Z');
    const j = computeJumps({ event: ev(mid), nextEvent: ev(next) });
    expect(NEXT_EVENT_JUMP).toBe(-22 * MIN);
    expect(j.nextEvent).toBe(next - 22 * MIN);
  });

  it('без наступного слота — null; без події — усе null', () => {
    const mid = Date.parse('2026-12-31T22:00:00Z');
    expect(computeJumps({ event: ev(mid), nextEvent: null }).nextEvent).toBeNull();
    const none = computeJumps({ event: null, nextEvent: null });
    for (const id of JUMP_IDS) expect(none[id]).toBeNull();
  });

  it('на справжньому графіку: «північ» потрапляє на слот currentAirEvent', () => {
    const d = getData();
    const now = Date.parse('2027-01-01T01:38:00+02:00');
    const air = currentAirEvent(now, d, d.chainsByEventId);
    const j = computeJumps(air);
    expect(j.midnight).toBe(Date.parse('2027-01-01T00:00:00Z'));
    expect(j.nextEvent).not.toBeNull();
    expect(j.nextEvent!).toBeGreaterThan(j.midnight!);
  });
});
