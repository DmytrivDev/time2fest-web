import type { Event, Ms, OfferState, Stamp } from '@/lib/data/types';
import { TYPING_QUIET } from './config';
import { isTooCloseToNextForOffer, midnightOf, offerEarliestAt } from '@time2fest/rules/time';

type EventLike = Pick<Event, 'id' | 'midnightUtc'> & { midnightMs?: Ms };

export interface OfferContext {
  stamps: Stamp[];
  lastEvent: EventLike | null;
  nextEvent: EventLike | null;
  hasPass: boolean;
  rate: 'open' | 'closed' | 'none';
  offers: OfferState;
  ui: { overlayOpen: boolean; composerFocused: boolean; lastKeystrokeAt?: Ms };
}

export type OfferBlock =
  | 'stamps'
  | 'pass'
  | 'too-early'
  | 'too-late'
  | 'rate-open'
  | 'already-shown'
  | 'dismissed'
  | 'overlay'
  | 'typing'
  | 'one-per-event';

export interface OfferDecision {
  show: 'pass-offer' | null;
  blockedBy?: OfferBlock[];
  recheckAt?: Ms;
}

/** Пропозиція пасу — з другого штампа. */
const MIN_STAMPS = 2;

/**
 * Правила пропозиції пасу (`data-model.md` 3.4, FR-063). Пропозиції «Чайові» після третього штампа більше немає
 * (рішення власника 2026-11-12): тост — головний платний продукт, доступний усім і завжди через смугу тостів під
 * плеєром, келих у полі чату й «Підтримати».
 */
export function offerEligibility(now: Ms, ctx: OfferContext): OfferDecision {
  const blocked: OfferBlock[] = [];
  const recheck: Ms[] = [];

  if (!ctx.lastEvent) return { show: null, blockedBy: ['stamps'] };
  const last = ctx.lastEvent;

  if (ctx.hasPass) blocked.push('pass');

  const history = ctx.offers.history.filter((h) => h.kind === 'pass-offer');
  if (ctx.stamps.length < MIN_STAMPS) blocked.push('stamps');
  else if (history.some((h) => h.dismissedAt !== undefined)) blocked.push('dismissed');
  else if (history.length) blocked.push('already-shown');

  if (history.some((h) => h.triggerEventId === last.id)) blocked.push('one-per-event');

  const earliest = offerEarliestAt(midnightOf(last));
  if (now < earliest) {
    blocked.push('too-early');
    recheck.push(earliest);
  }
  if (ctx.nextEvent && isTooCloseToNextForOffer(now, midnightOf(ctx.nextEvent))) blocked.push('too-late');

  if (ctx.rate === 'open') blocked.push('rate-open');
  if (ctx.offers.visible !== null || ctx.ui.overlayOpen) blocked.push('overlay');

  const ks = ctx.ui.lastKeystrokeAt;
  const typingRecent = ks !== undefined && now - ks < TYPING_QUIET;
  if (ctx.ui.composerFocused || typingRecent) {
    blocked.push('typing');
    if (typingRecent && !ctx.ui.composerFocused) recheck.push(ks + TYPING_QUIET);
  }

  const unique = [...new Set(blocked)];
  const decision: OfferDecision = { show: unique.length === 0 ? 'pass-offer' : null };
  if (unique.length) decision.blockedBy = unique;
  if (decision.show === null && recheck.length) decision.recheckAt = Math.min(...recheck);
  return decision;
}
