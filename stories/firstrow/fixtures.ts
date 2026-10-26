import type { FirstRowSeat, Ms } from '@/lib/data/types';
import { firstRowView, type FirstRowView } from '@/lib/engine/firstRowView';

export const MIDNIGHT: Ms = Date.parse('2027-01-01T00:00:00Z');
export const NOW_OPEN: Ms = MIDNIGHT - 3_600_000;
export const NOW_CLOSED: Ms = MIDNIGHT - 600_000;
export const RESTRAINED_NOTE = 'Цього вечора ми без анімації та привітань — стіна тиха.';
const EVENT = { id: 'evt_london_2027', midnightUtc: '2027-01-01T00:00:00Z', firstRow: { saleEnabled: true } };
const NAMES: [string, string, string][] = [
  ['Олена і друзі', 'UA', 'glasses'],
  ['Marta', 'PL', 'heart'],
  ['Tom', 'GB', 'fireworks'],
  ['Ліза', 'UA', 'star'],
  ['Jonas', 'DE', 'smile'],
  ['Аня', 'UA', 'dance'],
  ['Pedro', 'PT', 'confetti'],
  ['Sofia', 'IT', 'hug'],
  ['Max', 'US', 'fire'],
  ['Ірина', 'UA', 'gift'],
];

/** Перші `taken` місць зайняті; `mine` — номер місця гостя `me`. */
export function makeSeats(taken: number, mine?: number): FirstRowSeat[] {
  return Array.from({ length: 10 }, (_, i): FirstRowSeat => {
    const number = i + 1;
    const n = NAMES[i]!;
    if (number <= taken) {
      return {
        eventId: EVENT.id,
        number,
        state: 'taken',
        takenAt: NOW_OPEN - 1000,
        participant: {
          holderId: number === mine ? 'me' : `seed-${number}`,
          name: n[0],
          flagCode: n[1],
          greeting: 'З Новим роком!',
          emojiId: n[2],
          isMine: number === mine,
        },
      };
    }
    return { eventId: EVENT.id, number, state: 'free' };
  });
}

export function makeView(opts: { taken: number; mine?: number; pass?: boolean; closed?: boolean; restrained?: boolean }): {
  view: FirstRowView;
  seats: FirstRowSeat[];
} {
  const seats = makeSeats(opts.taken, opts.mine);
  const event = opts.restrained ? { ...EVENT, restrained: { note: { uk: RESTRAINED_NOTE } } } : EVENT;
  const view = firstRowView(opts.closed ? NOW_CLOSED : NOW_OPEN, event, seats, { id: 'me', hasPass: !!opts.pass });
  return { view, seats };
}

const COUNTRIES: Record<string, string> = { UA: 'Україна', PL: 'Польща', GB: 'Велика Британія', DE: 'Німеччина', PT: 'Португалія', IT: 'Італія', US: 'США' };
export const countryName = (code: string): string | undefined => COUNTRIES[code];
