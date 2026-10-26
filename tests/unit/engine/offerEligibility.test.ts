import { describe, expect, it } from 'vitest';
import type { OfferState, Stamp } from '@/lib/data/types';
import { offerEligibility, type OfferContext } from '@/lib/engine/offerEligibility';
import { event, LONDON_MIDNIGHT, MIN, RIO_MIDNIGHT, SEC } from '../fixtures/data';

const london = event('london', LONDON_MIDNIGHT);
const rio = event('rio', RIO_MIDNIGHT);
const stamp = (id: string): Stamp => ({
  eventId: id,
  grantedAt: 0,
  presenceSource: 'air',
  illustrationId: 'x',
  cityName: id,
  countryIso: 'GB',
});
const noOffers = (): OfferState => ({ nightId: '2026-27', history: [], visible: null });

function ctx(over: Partial<OfferContext> = {}): OfferContext {
  return {
    stamps: [stamp('evt_paris_2027'), stamp('evt_london_2027')],
    lastEvent: london,
    nextEvent: rio,
    hasPass: false,
    rate: 'closed',
    offers: noOffers(),
    ui: { overlayOpen: false, composerFocused: false },
    ...over,
  };
}
const OK_NOW = LONDON_MIDNIGHT + 6 * MIN;

describe('offerEligibility', () => {
  it('пропозиція пасу після 2-го штампа', () => {
    expect(offerEligibility(OK_NOW, ctx()).show).toBe('pass-offer');
    const one = offerEligibility(OK_NOW, ctx({ stamps: [stamp('evt_london_2027')] }));
    expect(one.show).toBeNull();
    expect(one.blockedBy).toContain('stamps');
  });

  it('чайові після 3-го штампа, якщо пас уже показували', () => {
    const offers: OfferState = {
      nightId: '2026-27',
      history: [{ kind: 'pass-offer', triggerEventId: 'evt_paris_2027', shownAt: 0 }],
      visible: null,
    };
    const three = [stamp('evt_tokyo_2027'), stamp('evt_paris_2027'), stamp('evt_london_2027')];
    expect(offerEligibility(OK_NOW, ctx({ stamps: three, offers })).show).toBe('tips');
    // з двома штампами чайових немає
    expect(offerEligibility(OK_NOW, ctx({ offers })).show).toBeNull();
  });

  it('пас має пріоритет, якщо ще не показувався цієї ночі', () => {
    const three = [stamp('evt_tokyo_2027'), stamp('evt_paris_2027'), stamp('evt_london_2027')];
    expect(offerEligibility(OK_NOW, ctx({ stamps: three })).show).toBe('pass-offer');
  });

  it('лише без пасу', () => {
    const d = offerEligibility(OK_NOW, ctx({ hasPass: true }));
    expect(d.show).toBeNull();
    expect(d.blockedBy).toContain('pass');
  });

  it('now ≥ lastEvent + 5 хв; recheckAt — початок вікна', () => {
    const d = offerEligibility(LONDON_MIDNIGHT + 4 * MIN, ctx());
    expect(d.show).toBeNull();
    expect(d.blockedBy).toContain('too-early');
    expect(d.recheckAt).toBe(LONDON_MIDNIGHT + 5 * MIN);
    expect(offerEligibility(LONDON_MIDNIGHT + 5 * MIN, ctx()).show).toBe('pass-offer');
  });

  it('до наступної події ≥ 10 хв; без наступної — верхньої межі нема', () => {
    expect(offerEligibility(RIO_MIDNIGHT - 10 * MIN, ctx()).show).toBe('pass-offer');
    const late = offerEligibility(RIO_MIDNIGHT - 10 * MIN + 1, ctx());
    expect(late.show).toBeNull();
    expect(late.blockedBy).toContain('too-late');
    expect(offerEligibility(RIO_MIDNIGHT, ctx({ nextEvent: null })).show).toBe('pass-offer');
  });

  it('оцінку закрито', () => {
    const d = offerEligibility(OK_NOW, ctx({ rate: 'open' }));
    expect(d.show).toBeNull();
    expect(d.blockedBy).toContain('rate-open');
    expect(offerEligibility(OK_NOW, ctx({ rate: 'none' })).show).toBe('pass-offer');
  });

  it('одна за раз: інша картка у потоці або відкрите вікно', () => {
    expect(offerEligibility(OK_NOW, ctx({ offers: { ...noOffers(), visible: 'pass-info' } })).blockedBy).toContain('overlay');
    expect(offerEligibility(OK_NOW, ctx({ ui: { overlayOpen: true, composerFocused: false } })).blockedBy).toContain(
      'overlay',
    );
  });

  it('не під час введення в чаті й ~10 с після останнього натискання', () => {
    expect(offerEligibility(OK_NOW, ctx({ ui: { overlayOpen: false, composerFocused: true } })).blockedBy).toContain(
      'typing',
    );
    const d = offerEligibility(OK_NOW, ctx({ ui: { overlayOpen: false, composerFocused: false, lastKeystrokeAt: OK_NOW - 4 * SEC } }));
    expect(d.blockedBy).toContain('typing');
    expect(d.recheckAt).toBe(OK_NOW + 6 * SEC);
    expect(
      offerEligibility(OK_NOW, ctx({ ui: { overlayOpen: false, composerFocused: false, lastKeystrokeAt: OK_NOW - 10 * SEC } }))
        .show,
    ).toBe('pass-offer');
  });

  it('закрита хрестиком не повертається тієї ночі; показана — не вдруге', () => {
    const dismissed: OfferState = {
      nightId: '2026-27',
      history: [{ kind: 'pass-offer', triggerEventId: 'evt_paris_2027', shownAt: 0, dismissedAt: 1 }],
      visible: null,
    };
    const d = offerEligibility(OK_NOW, ctx({ offers: dismissed }));
    expect(d.show).toBeNull();
    expect(d.blockedBy).toContain('dismissed');
  });

  it('не більше однієї пропозиції на lastEvent', () => {
    const offers: OfferState = {
      nightId: '2026-27',
      history: [{ kind: 'pass-offer', triggerEventId: 'evt_london_2027', shownAt: 0 }],
      visible: null,
    };
    const three = [stamp('evt_tokyo_2027'), stamp('evt_paris_2027'), stamp('evt_london_2027')];
    const d = offerEligibility(OK_NOW, ctx({ stamps: three, offers }));
    expect(d.show).toBeNull();
    expect(d.blockedBy).toContain('one-per-event');
  });

  it('без останньої події — нічого', () => {
    expect(offerEligibility(OK_NOW, ctx({ lastEvent: null })).show).toBeNull();
  });
});
