import type { Event, Ms } from '@/lib/data/types';
import {
  HANDOVER_AFTER,
  HOWTO_BEFORE,
  LAST_MINUTE_FROM,
  OFFER_MIN_AFTER,
  RATE_DURATION,
  RATE_OPEN_AFTER,
  STAMP_DELAY,
} from './config';
import { midnightOf } from './eventStatus';

export interface MomentTimeline {
  eventId: string;
  t0: Ms;
  howToFrom: Ms;
  stampAt: Ms;
  rateOpenAt: Ms;
  rateCloseAt: Ms;
  offerEarliestAt: Ms;
  handoverSoonAt: Ms;
  handoverAt: Ms;
}

export type MomentStage = 'pre' | 'awaiting-stamp' | 'stamp' | 'rate' | 'after-rate';

/** `data-model.md` 3.3: усі моменти події від `midnightUtc`. */
export function momentTimeline(event: Pick<Event, 'id' | 'midnightUtc'> & { midnightMs?: Ms }): MomentTimeline {
  const t0 = midnightOf(event);
  const rateOpenAt = t0 + RATE_OPEN_AFTER;
  return {
    eventId: event.id,
    t0,
    howToFrom: t0 - HOWTO_BEFORE,
    stampAt: t0 + STAMP_DELAY,
    rateOpenAt,
    rateCloseAt: rateOpenAt + RATE_DURATION,
    offerEarliestAt: t0 + OFFER_MIN_AFTER,
    handoverSoonAt: t0 + LAST_MINUTE_FROM,
    handoverAt: t0 + HANDOVER_AFTER,
  };
}

export interface MomentStateOptions {
  /** Фокус усередині картки оцінки або гість змінює оцінку. */
  rateInteracting?: boolean;
  /** Гість оцінив або закрив картку (×) — більше не з’являється. */
  rateClosed?: boolean;
}

export interface MomentState {
  stage: MomentStage;
  /** Закриття за часом відкладене через взаємодію (WCAG 2.2.1). */
  rateMustStayOpen: boolean;
}

export function momentState(now: Ms, tl: MomentTimeline, opts: MomentStateOptions = {}): MomentState {
  if (now < tl.t0) return { stage: 'pre', rateMustStayOpen: false };
  if (now < tl.stampAt) return { stage: 'awaiting-stamp', rateMustStayOpen: false };
  if (now < tl.rateOpenAt) return { stage: 'stamp', rateMustStayOpen: false };
  if (opts.rateClosed) return { stage: 'after-rate', rateMustStayOpen: false };
  if (opts.rateInteracting) return { stage: 'rate', rateMustStayOpen: true };
  if (now < tl.rateCloseAt) return { stage: 'rate', rateMustStayOpen: false };
  return { stage: 'after-rate', rateMustStayOpen: false };
}

export function momentStage(now: Ms, tl: MomentTimeline, opts?: MomentStateOptions): MomentStage {
  return momentState(now, tl, opts).stage;
}
