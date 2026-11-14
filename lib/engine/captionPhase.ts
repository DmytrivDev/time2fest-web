import type { Event, Ms } from '@/lib/data/types';
import {
  DELAY_NOTICE_FROM,
  HANDOVER_AFTER,
  HOWTO_BEFORE,
  LAST_MINUTE_FROM,
  RECORDING_AFTER,
  STAMP_DELAY,
} from './config';
import { midnightOf } from './eventStatus';

export type CaptionMode = 'broadcast' | 'remote';
export type CaptionPhaseId = 'before' | 'celebrating' | 'last-minute' | 'next';

export type CaptionRow1Right =
  | { kind: 'countdown'; ms: number }
  | { kind: 'none' }
  | { kind: 'handover'; ms: number }
  | { kind: 'ago'; ms: number };

export type CaptionRow3 =
  | { kind: 'midnight-at'; eventId: string }
  | { kind: 'met'; eventId: string }
  | { kind: 'next'; nextEventId: string }
  | { kind: 'met-and-next'; eventId: string; nextEventId: string };

/**
 * `'watch-again'` — «Подивитися північ ще раз» (remote, `recording`, є `source.replay`);
 * доповнює тип з data-model 3.2, де ця кнопка описана лише текстом.
 */
export type CaptionButton = 'choose-stream' | 'stay-here' | 'watch-again';

export interface CaptionPhase {
  id: CaptionPhaseId;
  row1Right: CaptionRow1Right;
  row3: CaptionRow3;
  button: CaptionButton;
  flags: { howTo: boolean; delayNotice: boolean; momentFired: boolean };
}

type EventLike = Pick<Event, 'id' | 'midnightUtc'> & { midnightMs?: Ms };

const NO_FLAGS = { howTo: false, delayNotice: false, momentFired: false };

/**
 * Фази до моменту (`t < +15 с`) — спільні для broadcast і remote. Після півночі (0…+15 с) таймера вже немає й рядок 3 —
 * «<Країна> зустріла Новий рік» (`docs/site/home.md`); раніше тут стояло «до півночі 00:00:00» і «північ о …» —
 * нуль із підписом «до півночі» вже після півночі (перевірка дошок 2026-11-14). Штамп і `momentFired` — як і раніше з +15 с.
 */
function prePhase(t: number, event: EventLike): CaptionPhase {
  const after = t >= 0;
  return {
    id: after ? 'celebrating' : 'before',
    row1Right: after ? { kind: 'none' } : { kind: 'countdown', ms: -t },
    row3: after ? { kind: 'met', eventId: event.id } : { kind: 'midnight-at', eventId: event.id },
    button: 'choose-stream',
    flags: { howTo: t >= -HOWTO_BEFORE, delayNotice: t >= -DELAY_NOTICE_FROM, momentFired: false },
  };
}

function metPhase(event: EventLike): CaptionPhase {
  return {
    id: 'celebrating',
    row1Right: { kind: 'none' },
    row3: { kind: 'met', eventId: event.id },
    button: 'choose-stream',
    flags: { ...NO_FLAGS, momentFired: true },
  };
}

/**
 * Фаза підпису під плеєром (`data-model.md` 3.2). `next` — подія наступного слота
 * (broadcast) або наступна подія розкладу (remote).
 */
export function captionPhase(
  now: Ms,
  event: EventLike,
  mode: CaptionMode,
  next: EventLike | null,
  opts: { hasReplay?: boolean } = {},
): CaptionPhase {
  const t = now - midnightOf(event);
  if (t < STAMP_DELAY) return prePhase(t, event);

  if (mode === 'remote') {
    if (t < RECORDING_AFTER) return metPhase(event);
    return {
      id: 'celebrating',
      row1Right: { kind: 'ago', ms: t },
      row3: next ? { kind: 'met-and-next', eventId: event.id, nextEventId: next.id } : { kind: 'met', eventId: event.id },
      button: opts.hasReplay ? 'watch-again' : 'choose-stream',
      flags: { ...NO_FLAGS, momentFired: true },
    };
  }

  if (!next) return metPhase(event); // кінець свята: переходити нікуди
  if (t < LAST_MINUTE_FROM) return metPhase(event);
  if (t < HANDOVER_AFTER) {
    return {
      id: 'last-minute',
      row1Right: { kind: 'handover', ms: HANDOVER_AFTER - t },
      row3: { kind: 'next', nextEventId: next.id },
      button: 'stay-here',
      flags: { ...NO_FLAGS, momentFired: true },
    };
  }
  // Передача: ефір уже на наступній події — її фаза `before`.
  const tn = now - midnightOf(next);
  return { ...prePhase(Math.min(tn, -1), next), id: 'next' };
}
