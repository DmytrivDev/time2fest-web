import { describe, expect, it } from 'vitest';
import { FIREWORKS_MS } from '@/components/player/Fireworks';
import { CHIME_SECONDS, hms, midnightPhase } from '@/components/player/SceneMidnight';

const M = Date.parse('2027-01-01T01:00:00Z');

describe('сцена відліку: північ (власник 2026-11-11)', () => {
  it('до 12 с — великий відлік; останні 12 с — секунди курантів; опівночі — салют 40 с; далі — нічого', () => {
    expect(midnightPhase(M, 0)).toEqual({ kind: 'idle' });
    expect(midnightPhase(M, M - 5 * 60_000)).toEqual({ kind: 'count', left: 5 * 60_000 });
    expect(midnightPhase(M, M - CHIME_SECONDS * 1_000)).toEqual({ kind: 'final', sec: 12 });
    expect(midnightPhase(M, M - 400)).toEqual({ kind: 'final', sec: 1 });
    expect(midnightPhase(M, M)).toEqual({ kind: 'celebrate', since: 0 });
    expect(midnightPhase(M, M + FIREWORKS_MS)).toEqual({ kind: 'after' });
  });

  it('відлік — як таймер підпису', () => {
    expect(hms(21 * 60_000 + 52_000)).toBe('00:21:52');
    expect(hms(3_600_000 + 1)).toBe('01:00:01');
  });
});
