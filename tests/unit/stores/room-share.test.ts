import { describe, expect, it } from 'vitest';
import { parseRoomShare, roomShareUrl } from '@/components/room/roomShare';
import { getData } from '@/lib/data/load';

describe('«Поділитися кімнатою»: місця сітки в посиланні', () => {
  const a = { slot: 0, sourceId: 'src_london_1', eventId: 'evt_london_2027', pos: 0 };
  const b = { slot: 1, sourceId: 'src_london_2', eventId: 'evt_london_2027', pos: 3 };

  it('порожні місця між вікнами — порожні елементи', () => {
    expect(roomShareUrl([a, b], 'https://x')).toBe('https://x/room/?w=src_london_1,,,src_london_2');
  });

  it('посилання відкриває вікна на тих самих місцях; невідоме джерело не зсуває інші', () => {
    const list = parseRoomShare('src_london_1,nope,,src_london_2', getData());
    expect(list.map((w) => [w.sourceId, w.pos])).toEqual([
      ['src_london_1', 0],
      ['src_london_2', 3],
    ]);
  });

  it('старі посилання без порожніх місць — вікна підряд', () => {
    expect(parseRoomShare('src_london_1,src_london_2', getData()).map((w) => w.pos)).toEqual([0, 1]);
  });
});
