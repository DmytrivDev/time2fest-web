import { describe, expect, it } from 'vitest';
import {
  applySiteEvent,
  catalogVersionOf,
  parseSiteState,
  siteEventId,
  PUBLIC_ROUTES,
  SITE_R2_KEYS,
  type SiteState,
} from '../src/index';
import { SiteStateSchema, SiteSwitchBodySchema, SiteDoorBodySchema } from '../src/schemas';

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
    viewersCount: true,
    passOffer: true,
    chatRooms: {},
    toastTiers: { '2': true, '5': true, '10': true },
  },
  products: [{ key: 'pass', price: { amount: 500, currency: 'USD' }, priceVersion: 1 }],
  catalogVersion: 'a+b',
  eventPatches: { kyiv: { moment: 1, restrained: { note: 'x' } } },
});

describe('site contract', () => {
  it('snapshot without the viewersCount key parses with true', () => {
    const { viewersCount: _omit, ...rest } = make(1).switches;
    void _omit;
    const old = { ...make(1), switches: rest };
    expect(parseSiteState(old)?.switches.viewersCount).toBe(true);
    expect(SiteStateSchema.parse(old).switches.viewersCount).toBe(true);
    expect(parseSiteState({ ...make(1), switches: { ...rest, viewersCount: 'x' } })).toBeNull();
  });

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

describe('applySiteEvent outage rule (AC-47, AC-46)', () => {
  it('applies an outage snapshot with version 1 after 50 applied, then the first normal one (51) and drops older normal ones', () => {
    const cur = make(50);
    const outage: SiteState = { ...make(1), outage: 'technical' };
    const afterOutage = applySiteEvent(cur, { type: 'snapshot', state: outage });
    expect(afterOutage).toBe(outage);
    const normal = make(51);
    expect(applySiteEvent(afterOutage, { type: 'snapshot', state: normal })).toBe(normal);
    expect(applySiteEvent(normal, { type: 'snapshot', state: make(49) })).toBe(normal);
  });
});

describe('site wire schema and guard (AC-1, NFR-1)', () => {
  const sw = make(1).switches;
  const bad: [string, unknown][] = [
    ['null', null],
    ['array', []],
    ['extra root key', { ...make(1), minBuild: 1 }],
    ['version 0', { ...make(1), version: 0 }],
    ['version float', { ...make(1), version: 1.5 }],
    ['bad at', { ...make(1), at: 'not a date' }],
    ['switch not boolean', { ...make(1), switches: { ...sw, chat: 'yes' } }],
    ['extra switch key', { ...make(1), switches: { ...sw, extra: true } }],
    ['unknown product key', { ...make(1), products: [{ key: 'toast:7', price: { amount: 1, currency: 'USD' }, priceVersion: 1 }] }],
    ['negative price', { ...make(1), products: [{ key: 'pass', price: { amount: -1, currency: 'USD' }, priceVersion: 1 }] }],
    ['unknown outage', { ...make(1), outage: 'planned' }],
    ['patch with extra key', { ...make(1), eventPatches: { kyiv: { color: 'red' } } }],
  ];

  it('accepts the sim snapshot, with and without outage, in both schema and guard', () => {
    for (const s of [make(1), { ...make(2), outage: 'technical' as const }]) {
      expect(SiteStateSchema.safeParse(s).success).toBe(true);
      expect(parseSiteState(s)).toBe(s);
    }
  });

  it.each(bad)('refuses %s identically in schema and guard', (_name, value) => {
    expect(SiteStateSchema.safeParse(value).success).toBe(false);
    expect(parseSiteState(value)).toBeNull();
  });

  it('keeps 300 patches and 4 products within 32 768 bytes', () => {
    const eventPatches: SiteState['eventPatches'] = Object.fromEntries(
      Array.from({ length: 300 }, (_, i) => [`ev-${i}-xx`, { moment: 1_800_000_000_000 + i, restrained: { note: 'n' } }]),
    );
    const products = (['pass', 'toast:2', 'toast:5', 'toast:10'] as const).map((key) => ({
      key,
      price: { amount: 500, currency: 'USD' as const },
      priceVersion: 1,
    }));
    const big: SiteState = { ...make(1), products, eventPatches };
    expect(SiteStateSchema.safeParse(big).success).toBe(true);
    expect(parseSiteState(big)).toBe(big);
    expect(new TextEncoder().encode(JSON.stringify(big)).length).toBeLessThanOrEqual(32_768);
  });

  it('body schemas: reason 1..200 and strict doors; constants', () => {
    expect(SiteSwitchBodySchema.safeParse({ key: 'chat', value: false, reason: 'x' }).success).toBe(true);
    expect(SiteSwitchBodySchema.safeParse({ key: 'chat', value: false, reason: '' }).success).toBe(false);
    expect(SiteSwitchBodySchema.safeParse({ key: 'chat', value: false, reason: 'x'.repeat(201) }).success).toBe(false);
    expect(SiteDoorBodySchema.safeParse({ action: 'reset' }).success).toBe(true);
    expect(SiteDoorBodySchema.safeParse({ action: 'reset', x: 1 }).success).toBe(false);
    expect(siteEventId(7)).toBe('site:7');
    expect(SITE_R2_KEYS.redButton).toBe('site/red-button.json');
    expect(PUBLIC_ROUTES.map((r) => r.path)).toEqual(['/api/site/state']);
    expect(PUBLIC_ROUTES[0]).toMatchObject({ freshMs: 10_000, staleMs: 30_000 });
  });
});

describe('catalogVersionOf', () => {
  it('joins generatedAt and tzdbVersion with +', () => {
    expect(catalogVersionOf({ generatedAt: '2026-11-16T00:00:00Z', tzdbVersion: '2026a' })).toBe('2026-11-16T00:00:00Z+2026a');
  });
});
