/**
 * Вікно кімнати, чия трансляція закінчилась (правка власника 2026-11-15): через `HANDOVER_AFTER` (15 хв) після півночі
 * події вікно «завершилось», якщо трансляція вже не йде наживо; якщо ще йде — лишається до її кінця. Запис торішнього
 * свята (демо) «йде», доки не дійшов до кінця (`recordingPosition` = `replay`). Чиста логіка без React.
 */
import type { Event, Ms, StreamSource } from '@/lib/data/types';
import { handoverMoment, midnightOf } from '@time2fest/rules/time';
import { sourceStatus } from '@/lib/engine/sourceStatus';
import { recordingPosition } from '@/lib/player/recordingSync';

/** Скільки показуємо «Трансляція завершилась» із «Додати іншу», перш ніж вікно зникне. */
export const ENDED_CARD_MS = 90_000;

type EventLike = Pick<Event, 'midnightUtc'> & { midnightMs?: Ms };

/** Чи трансляція вікна ще йде: джерело наживо (дані) і, якщо це запис, він не дійшов до кінця. */
export function sourceStillLive(src: StreamSource | undefined, now: Ms): boolean {
  if (!src || sourceStatus(src, now) !== 'live') return false;
  if (src.videoId && recordingPosition(src.videoId, now)?.mode === 'replay') return false;
  return true;
}

/** Момент, відколи вікно вважається завершеним (`null` — ще ні): північ + 15 хв, якщо трансляція вже не йде. */
export function windowEndedAt(now: Ms, event: EventLike | undefined, src: StreamSource | undefined): Ms | null {
  if (!event) return null;
  const at = handoverMoment(midnightOf(event));
  if (now < at) return null;
  return sourceStillLive(src, now) ? null : at;
}
