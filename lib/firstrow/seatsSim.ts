/**
 * Імітація місць «Першого ряду» (T112, `data-model.md` 1.7).
 *
 * Чужі місця беруться з `chat-script.json → firstRowSeed`: зміщення `takenAtOffsetSec` / `heldUntilOffsetSec` і
 * `takeOverTime[].atOffsetFromNowSec` рахуються від «зараз» — моменту, коли імітацію цієї події вперше запущено
 * у вкладці (`simStart`). Місце й утримання гостя — з `guest.firstRow[eventId]` (localStorage).
 *
 * Правила:
 * - утримання чужого місця, що минуло, — знову `free`;
 * - `takeOverTime`: у свій час місце займає імітований учасник. Якщо це місце утримує гість, учасник займає інше
 *   вільне; якщо інших немає — гість «програв гонку» (`holdLost`): оплата дасть «Розпродано» (US5, сценарій 3);
 * - місце гостя (`entry.seat`) — `taken` з `isMine`; активне утримання гостя — `held` з `holderId = guest.id`.
 */
import type { FirstRowSeat, FirstRowSeedEntry, GuestFirstRowEntry, Ms, SeatParticipant } from '@/lib/data/types';
import { SEATS } from '@/lib/engine/config';

export interface SimGuest {
  id: string;
  nick?: string;
  flagCode?: string;
  entry?: GuestFirstRowEntry;
}

/** Імітовані покупці для `takeOverTime` (по колу за номером місця). */
export const TAKEOVER_PARTICIPANTS: readonly Omit<SeatParticipant, 'holderId'>[] = [
  { name: 'Sofía', flagCode: 'ES', greeting: '¡Feliz Año Nuevo!', emojiId: 'confetti' },
  { name: 'Tom & Mia', flagCode: 'GB', greeting: 'Cheers from the river!', emojiId: 'fireworks' },
  { name: 'Ana', flagCode: 'PT', greeting: 'Feliz Ano Novo!', emojiId: 'star' },
  { name: 'Lukas', flagCode: 'DE', greeting: 'Prosit Neujahr!', emojiId: 'sparkles' },
];

export const GUEST_FALLBACK_FLAG = 'UN';

interface SimResult {
  seats: FirstRowSeat[];
  /** Місце, яке утримував гість, зайняв імітований учасник (інших вільних не було). */
  holdLost: boolean;
}

function participantFor(eventId: string, number: number): SeatParticipant {
  const p = TAKEOVER_PARTICIPANTS[number % TAKEOVER_PARTICIPANTS.length]!;
  return { ...p, holderId: `sim-${eventId}-${number}` };
}

/** Усі 10 місць події в момент `now`. */
export function simulateSeats(
  seed: FirstRowSeedEntry | undefined,
  eventId: string,
  simStart: Ms,
  now: Ms,
  guest: SimGuest,
): SimResult {
  const byNumber = new Map<number, FirstRowSeat>();
  for (let n = 1; n <= SEATS; n++) byNumber.set(n, { eventId, number: n, state: 'free' });

  for (const s of seed?.seats ?? []) {
    if (s.number < 1 || s.number > SEATS) continue;
    if (s.state === 'taken') {
      byNumber.set(s.number, {
        eventId,
        number: s.number,
        state: 'taken',
        takenAt: simStart + (s.takenAtOffsetSec ?? 0) * 1000,
        participant: {
          holderId: `seed-${s.number}`,
          name: s.name ?? '',
          flagCode: s.flagCode ?? GUEST_FALLBACK_FLAG,
          greeting: s.greeting ?? '',
          emojiId: s.emojiId ?? 'sparkles',
        },
      });
    } else if (s.state === 'held') {
      const until = simStart + (s.heldUntilOffsetSec ?? 0) * 1000;
      if (until > now) byNumber.set(s.number, { eventId, number: s.number, state: 'held', until, holderId: `seed-${s.number}` });
    }
  }

  const entry = guest.entry;
  // Місце гостя (після успішної оплати) — понад сид.
  if (entry?.seat !== undefined && entry.seat >= 1 && entry.seat <= SEATS) {
    const draft = entry.draft;
    byNumber.set(entry.seat, {
      eventId,
      number: entry.seat,
      state: 'taken',
      takenAt: simStart,
      participant: {
        holderId: guest.id,
        name: draft?.name || guest.nick || '',
        flagCode: guest.flagCode ?? GUEST_FALLBACK_FLAG,
        greeting: draft?.greeting ?? '',
        emojiId: draft?.emojiId ?? 'glasses',
        isMine: true,
      },
    });
  }
  const hold = entry?.seat === undefined && entry?.hold && entry.hold.until > now ? entry.hold : undefined;
  if (hold) byNumber.set(hold.seat, { eventId, number: hold.seat, state: 'held', until: hold.until, holderId: guest.id });

  let holdLost = false;
  const takeovers = [...(seed?.takeOverTime ?? [])].sort((a, b) => a.atOffsetFromNowSec - b.atOffsetFromNowSec);
  for (const tk of takeovers) {
    const at = simStart + tk.atOffsetFromNowSec * 1000;
    if (at > now) continue;
    let target = byNumber.get(tk.number);
    if (!target) continue;
    const guestHolds = target.state === 'held' && target.holderId === guest.id;
    if (target.state === 'taken' || (target.state === 'held' && !guestHolds)) continue;
    if (guestHolds) {
      const other = [...byNumber.values()].find((s) => s.state === 'free');
      if (other) target = other;
      else holdLost = true;
    }
    byNumber.set(target.number, { eventId, number: target.number, state: 'taken', takenAt: at, participant: participantFor(eventId, target.number) });
  }

  return { seats: [...byNumber.values()].sort((a, b) => a.number - b.number), holdLost };
}

/** Найменший номер вільного місця (для нового утримання) або `undefined`. */
export function firstFreeSeat(seats: readonly FirstRowSeat[], now: Ms): number | undefined {
  return seats.find((s) => s.state === 'free' || (s.state === 'held' && s.until <= now))?.number;
}

/** Код квитка: «LON-04». */
export function ticketCode(cityId: string, seat: number): string {
  const letters = cityId.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'T2F';
  return `${letters}-${String(seat).padStart(2, '0')}`;
}
