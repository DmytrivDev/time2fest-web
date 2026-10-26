import type { Event, Ms, OfferKind, OfferState, Stamp } from '@/lib/data/types';
import { OFFER_MIN_AFTER, OFFER_MIN_BEFORE_NEXT, TYPING_QUIET } from './config';
import { midnightOf } from './eventStatus';

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
  show: 'pass-offer' | 'tips' | null;
  blockedBy?: OfferBlock[];
  recheckAt?: Ms;
}

const ENGINE_KINDS: OfferKind[] = ['pass-offer', 'tips'];
const MIN_STAMPS: Record<'pass-offer' | 'tips', number> = { 'pass-offer': 2, tips: 3 };

/** Правила пропозицій пасу й чайових (`data-model.md` 3.4, FR-063). */
export function offerEligibility(now: Ms, ctx: OfferContext): OfferDecision {
  const blocked: OfferBlock[] = [];
  const recheck: Ms[] = [];

  if (!ctx.lastEvent) return { show: null, blockedBy: ['stamps'] };
  const last = ctx.lastEvent;
  const count = ctx.stamps.length;

  if (ctx.hasPass) blocked.push('pass');

  // Який вид: пас, якщо ще не показувався цієї ночі; інакше чайові.
  const history = ctx.offers.history.filter((h) => ENGINE_KINDS.includes(h.kind));
  const dismissedKinds = new Set(history.filter((h) => h.dismissedAt !== undefined).map((h) => h.kind));
  const shownKinds = new Set(history.map((h) => h.kind));
  let kind: 'pass-offer' | 'tips' | null = null;
  const reasons = new Set<OfferBlock>();
  for (const k of ['pass-offer', 'tips'] as const) {
    if (count < MIN_STAMPS[k]) {
      reasons.add('stamps');
      continue;
    }
    if (dismissedKinds.has(k)) {
      reasons.add('dismissed');
      continue;
    }
    if (shownKinds.has(k)) {
      reasons.add('already-shown');
      continue;
    }
    kind = k;
    break;
  }
  if (!kind) blocked.push(...reasons);

  if (history.some((h) => h.triggerEventId === last.id)) blocked.push('one-per-event');

  const earliest = midnightOf(last) + OFFER_MIN_AFTER;
  if (now < earliest) {
    blocked.push('too-early');
    recheck.push(earliest);
  }
  if (ctx.nextEvent && midnightOf(ctx.nextEvent) - now < OFFER_MIN_BEFORE_NEXT) blocked.push('too-late');

  if (ctx.rate === 'open') blocked.push('rate-open');
  if (ctx.offers.visible !== null || ctx.ui.overlayOpen) blocked.push('overlay');

  const ks = ctx.ui.lastKeystrokeAt;
  const typingRecent = ks !== undefined && now - ks < TYPING_QUIET;
  if (ctx.ui.composerFocused || typingRecent) {
    blocked.push('typing');
    if (typingRecent && !ctx.ui.composerFocused) recheck.push(ks + TYPING_QUIET);
  }

  const unique = [...new Set(blocked)];
  const decision: OfferDecision = { show: unique.length === 0 ? kind : null };
  if (unique.length) decision.blockedBy = unique;
  if (decision.show === null && recheck.length) decision.recheckAt = Math.min(...recheck);
  return decision;
}
