import { describe, expect, it } from 'vitest';
import { applySiteEvent, catalogVersionOf, type SiteState } from '../src/index';

const make = (version: number): SiteState => ({
  version,
  at: new Date(0).toISOString(),
  switches: {
    chat: true,
    toasts: true,
    pass: true,
    passGift: true,
    payments: true,
    viewersMap: true,
    passOffer: true,
    chatRooms: {},
    toastTiers: { '2': true, '5': true, '10': true },
  },
  products: [{ key: 'pass', price: { amount: 500, currency: 'USD' }, priceVersion: 1 }],
  catalogVersion: 'a+b',
  eventPatches: { kyiv: { moment: 1, restrained: { note: 'x' } } },
});

describe('site contract', () => {
  it('rejects unknown fields on the state type', () => {
    const a: SiteState = {
      ...make(1),
      // @ts-expect-error announcements is not part of SiteState
      announcements: [],
    };
    const b: SiteState = {
      ...make(1),
      // @ts-expect-error minBuild is not part of SiteState
      minBuild: 1,
    };
    expect([a, b]).toHaveLength(2);
  });

  it('applySiteEvent: newer version wins, older and equal keep the same reference', () => {
    const cur = make(3);
    expect(applySiteEvent(cur, { type: 'snapshot', state: make(2) })).toBe(cur);
    expect(applySiteEvent(cur, { type: 'snapshot', state: make(3) })).toBe(cur);
    const newer = make(4);
    expect(applySiteEvent(cur, { type: 'snapshot', state: newer })).toBe(newer);
    const first = make(1);
    expect(applySiteEvent(undefined, { type: 'snapshot', state: first })).toBe(first);
  });
});

describe('catalogVersionOf', () => {
  it('joins generatedAt and tzdbVersion with +', () => {
    expect(catalogVersionOf({ generatedAt: '2026-11-16T00:00:00Z', tzdbVersion: '2026a' })).toBe('2026-11-16T00:00:00Z+2026a');
  });
});
