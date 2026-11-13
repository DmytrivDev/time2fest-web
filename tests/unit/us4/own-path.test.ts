import { describe, expect, it } from 'vitest';
import { buildOwnPath } from '@/lib/chat/authorPath';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';

describe('buildOwnPath — власний шлях глядача', () => {
  const data = getData();
  const events = [...data.eventsById.values()].sort((a, b) => a.midnightMs - b.midnightMs);
  const [e1, e2, e3, e4] = [events[0]!, events[5]!, events[10]!, events[15]!];
  const stamp = (eventId: string): Stamp => ({ eventId, grantedAt: 0, presenceSource: 'room', illustrationId: 'x', cityName: '', countryIso: '' });

  it('штампи — зустрінуті, графік без штампа й попереду — заплановані, по часу', () => {
    const now = e2.midnightMs + 1;
    const path = buildOwnPath([stamp(e2.id), stamp(e1.id)], [e2.id, e3.id, e4.id, e1.id], data, now);
    expect(path.map((p) => [p.id, p.planned])).toEqual([
      [e1.id, false],
      [e2.id, false],
      [e3.id, true],
      [e4.id, true],
    ]);
    expect(path.some((p) => 'firstRowSeat' in p)).toBe(false);
  });

  it('подія з графіка, що вже минула без штампа, — не показується', () => {
    expect(buildOwnPath([], [e1.id], data, e1.midnightMs + 1)).toEqual([]);
  });
});
