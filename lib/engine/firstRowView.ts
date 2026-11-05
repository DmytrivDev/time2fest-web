import type { Event, FirstRowSeat, GuestFirstRowEntry, ISO, Ms } from '@/lib/data/types';
import {
  FIRSTROW_SALE_CLOSE,
  FIRSTROW_SALE_OPEN,
  HOLD_EXTEND_OFFER,
  HOLD_WARN_1,
  HOLD_WARN_5,
  FEW_SEATS_THRESHOLD,
  FIRSTROW_PRICE,
  SEATS,
  STAMP_DELAY,
  WALL_LIGHTING_MS,
} from './config';
import { midnightOf } from './eventStatus';

/** `last3` — у продажу, вільних ≤ 3 (лише вигляд: лічильник виділено; ціна та сама). */
export type FirstRowViewState = 'empty' | 'open' | 'last3' | 'soldout' | 'closed' | 'mine' | 'restrained';

export interface FirstRowView {
  eventId: string;
  state: FirstRowViewState;
  /** Тільки `free`; утримані — не вільні. */
  freeCount: number;
  total: 10;
  price: {
    /** Ціна місця зараз (`FIRSTROW_PRICE`); `null` — не продається. */
    current: number | null;
    full: number;
    discountReason?: 'pass';
    /** Ціна зі знижкою пасу −50% (округлення вниз до цента: $2,49). */
    discounted?: number;
  };
  /** Ціна, зафіксована при відкритті форми, відрізняється від поточної (власник змінив ціну під час утримання). */
  priceChanged?: { from: number; to: number };
  saleClosesAt: Ms;
  mySeat?: { number: number; emojiId: string; greeting: string };
  hold?: {
    until: Ms;
    remainingMs: number;
    warn5: boolean;
    warn1: boolean;
    canExtend: boolean;
    /** «Ще 2 хвилини» + «Продовжити». */
    extendOffered: boolean;
  };
  /** Утримання гостя минуло: «Час утримання вийшов — місце знову вільне». */
  holdExpired?: boolean;
  nextSale?: { eventId: string; midnightUtc: ISO };
  wall: { phase: 'idle' | 'lighting' | 'lit'; lightingFrom: Ms };
}

/** Що двигун знає про гостя: id пристрою, пас і запис `GuestState.firstRow[eventId]`. */
export interface FirstRowGuest extends GuestFirstRowEntry {
  id: string;
  hasPass: boolean;
}

export interface FirstRowOptions {
  reducedMotion?: boolean;
  nextSale?: { eventId: string; midnightUtc: ISO };
}

type EventLike = Pick<Event, 'id' | 'midnightUtc' | 'restrained' | 'firstRow'> & { midnightMs?: Ms };

/** `data-model.md` 3.5. */
export function firstRowView(
  now: Ms,
  event: EventLike,
  seats: readonly FirstRowSeat[],
  guest: FirstRowGuest,
  opts: FirstRowOptions = {},
): FirstRowView {
  const t0 = midnightOf(event);
  const saleClosesAt = t0 - FIRSTROW_SALE_CLOSE;

  let free = 0;
  let mine: FirstRowSeat | undefined;
  for (const s of seats) {
    if (s.state === 'free' || (s.state === 'held' && s.until <= now)) free++;
    else if (s.state === 'taken' && s.participant.holderId === guest.id) mine = s;
  }
  // Місць, яких немає в списку, вважаємо вільними (рівно 10 на подію).
  free += Math.max(0, SEATS - seats.length);

  const activeHold = guest.hold && guest.hold.until > now ? guest.hold : undefined;
  const holdExpired = guest.hold !== undefined && !activeHold && !mine;

  const restrained = event.restrained !== undefined;
  const saleOpen = !!event.firstRow?.saleEnabled && now >= FIRSTROW_SALE_OPEN && now < saleClosesAt;

  let state: FirstRowViewState;
  if (restrained) state = 'restrained';
  else if (mine) state = 'mine';
  else if (!saleOpen) state = 'closed';
  else if (free === 0 && !activeHold) state = 'soldout';
  else if (free <= FEW_SEATS_THRESHOLD) state = 'last3'; // free = 0 лише з власним утриманням гостя
  else if (free === SEATS) state = 'empty';
  else state = 'open';

  const sellable = state === 'empty' || state === 'open' || state === 'last3';
  const current = sellable ? FIRSTROW_PRICE : null;

  const view: FirstRowView = {
    eventId: event.id,
    state,
    freeCount: free,
    total: SEATS,
    price: { current, full: FIRSTROW_PRICE },
    saleClosesAt,
    wall: wallOf(now, t0, opts.reducedMotion ?? false),
  };

  if (current !== null && guest.hasPass) {
    view.price.discountReason = 'pass';
    view.price.discounted = Math.floor(current * 50) / 100;
  }
  if (current !== null && guest.priceLocked !== undefined && guest.priceLocked !== current) {
    view.priceChanged = { from: guest.priceLocked, to: current };
  }
  if (mine && mine.state === 'taken') {
    view.mySeat = { number: mine.number, emojiId: mine.participant.emojiId, greeting: mine.participant.greeting };
  }
  if (activeHold) {
    const remainingMs = activeHold.until - now;
    view.hold = {
      until: activeHold.until,
      remainingMs,
      warn5: remainingMs <= HOLD_WARN_5,
      warn1: remainingMs <= HOLD_WARN_1,
      canExtend: !activeHold.extended,
      extendOffered: !activeHold.extended && remainingMs <= HOLD_EXTEND_OFFER,
    };
  }
  if (holdExpired) view.holdExpired = true;
  if (opts.nextSale) view.nextSale = opts.nextSale;
  return view;
}

function wallOf(now: Ms, t0: Ms, reducedMotion: boolean): FirstRowView['wall'] {
  const lightingFrom = t0 + STAMP_DELAY;
  if (now < lightingFrom) return { phase: 'idle', lightingFrom };
  if (reducedMotion || now >= lightingFrom + WALL_LIGHTING_MS) return { phase: 'lit', lightingFrom };
  return { phase: 'lighting', lightingFrom };
}
