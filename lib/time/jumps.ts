/**
 * Швидкі стрибки «машини часу» (contracts/time-machine.md): від півночі поточної події ефіру.
 * Чисті функції: панель (`components/dev/TimeMachinePanel`) лише підставляє результат у `machine.set`.
 */
import type { Ms } from '@/lib/data/types';
import { NEXT_EVENT_JUMP } from '@/lib/engine/config';
import type { AirState } from '@/lib/engine/currentAirEvent';

const MIN = 60_000;

export const JUMP_IDS = ['minus15m', 'minus1m', 'midnight', 'plus14m', 'nextEvent'] as const;
export type JumpId = (typeof JUMP_IDS)[number];

/** Зсув від `midnightMs` поточного слота (мс). */
export const JUMP_OFFSETS: Record<Exclude<JumpId, 'nextEvent'>, Ms> = {
  minus15m: -15 * MIN,
  minus1m: -MIN,
  midnight: 0,
  plus14m: 14 * MIN,
};

export type JumpTargets = Record<JumpId, Ms | null>;

/**
 * Цілі стрибків (мс epoch UTC) від події ефіру `air`. Без поточної події (свято скінчилося) усі `null`;
 * «наступна подія» — `null`, якщо наступного слота немає.
 */
export function computeJumps(air: Pick<AirState, 'event' | 'nextEvent'>): JumpTargets {
  const mid = air.event?.midnightMs;
  if (mid === undefined) return { minus15m: null, minus1m: null, midnight: null, plus14m: null, nextEvent: null };
  return {
    minus15m: mid + JUMP_OFFSETS.minus15m,
    minus1m: mid + JUMP_OFFSETS.minus1m,
    midnight: mid + JUMP_OFFSETS.midnight,
    plus14m: mid + JUMP_OFFSETS.plus14m,
    nextEvent: air.nextEvent ? air.nextEvent.midnightMs + NEXT_EVENT_JUMP : null,
  };
}
