/** Site domain rules (SPEC-08 AC-11, AC-13, AC-14, AC-19, AC-20), without a database. */
import { describe, expect, it } from 'vitest';
import type { SiteSwitches } from '@time2fest/contracts';
import { chooseProduct, clearProduct, type CatalogProduct } from '../../src/domain/site/products';
import { buildSnapshot, DEFAULT_SITE_RECORD, technicalOf } from '../../src/domain/site/snapshot';
import {
  applyToggle,
  checkToggle,
  DEFAULT_SWITCHES,
  type PaymentsPause,
  type ToggleRequest,
} from '../../src/domain/site/switches';

const on: SiteSwitches = DEFAULT_SWITCHES;
const paused: SiteSwitches = { ...DEFAULT_SWITCHES, payments: false };
const req = (over: Partial<ToggleRequest>): ToggleRequest => ({ key: 'chat', value: false, reason: 'maintenance', mode: 'manual', ...over });

describe('reason (AC-11)', () => {
  it('refuses an empty or whitespace reason', () => {
    expect(checkToggle(on, null, req({ reason: '' }))).toEqual({ ok: false, refuse: 'invalid' });
    expect(checkToggle(on, null, req({ reason: '   ' }))).toEqual({ ok: false, refuse: 'invalid' });
  });
  it('accepts 200 characters', () => {
    expect(checkToggle(on, null, req({ reason: 'a'.repeat(200) }))).toEqual({ ok: true });
  });
  it('refuses 201 characters', () => {
    expect(checkToggle(on, null, req({ reason: 'a'.repeat(201) }))).toEqual({ ok: false, refuse: 'invalid' });
  });
});

describe('key, room and tier', () => {
  it('refuses an unknown key', () => {
    expect(checkToggle(on, null, req({ key: 'nope' }))).toEqual({ ok: false, refuse: 'invalid' });
  });
  it('needs a room for chatRooms and a tier for toastTiers', () => {
    expect(checkToggle(on, null, req({ key: 'chatRooms' }))).toEqual({ ok: false, refuse: 'invalid' });
    expect(checkToggle(on, null, req({ key: 'toastTiers' }))).toEqual({ ok: false, refuse: 'invalid' });
    expect(checkToggle(on, null, req({ key: 'toastTiers', tier: '7' }))).toEqual({ ok: false, refuse: 'invalid' });
    expect(checkToggle(on, null, req({ key: 'chat', room: 'kyiv' }))).toEqual({ ok: false, refuse: 'invalid' });
  });
  it('closes a room and opens it again (absent = open)', () => {
    const closed = applyToggle(on, null, req({ key: 'chatRooms', room: 'kyiv', value: false }));
    expect(closed.switches.chatRooms).toEqual({ kyiv: false });
    expect(applyToggle(closed.switches, null, req({ key: 'chatRooms', room: 'kyiv', value: true })).switches.chatRooms).toEqual({});
  });
  it('turns one toast tier off', () => {
    expect(applyToggle(on, null, req({ key: 'toastTiers', tier: '5', value: false })).switches.toastTiers).toEqual({ '2': true, '5': false, '10': true });
  });
  it('returns the same values when nothing changes', () => {
    const same = applyToggle(on, null, req({ key: 'chat', value: true }));
    expect(same.switches).toBe(on);
    expect(same.paymentsPause).toBeNull();
  });
});

describe('auto only for payments (AC-14)', () => {
  for (const key of ['chat', 'toasts', 'pass', 'passGift', 'viewersMap', 'passOffer', 'chatRooms', 'toastTiers'] as const) {
    it(`refuses auto on ${key}`, () => {
      const extra = key === 'chatRooms' ? { room: 'kyiv' } : key === 'toastTiers' ? { tier: '2' } : {};
      expect(checkToggle(on, null, req({ key, mode: 'auto', ...extra }))).toEqual({ ok: false, refuse: 'forbidden' });
    });
  }
  it('allows auto on payments', () => {
    expect(checkToggle(on, null, req({ key: 'payments', mode: 'auto' }))).toEqual({ ok: true });
  });
});

describe('payments pause table (AC-13)', () => {
  const rows: { name: string; pause: PaymentsPause; current: SiteSwitches; call: ToggleRequest; refuse?: 'forbidden'; payments?: boolean; after?: PaymentsPause }[] = [
    { name: 'manual pause, auto enables → refused', pause: 'manual', current: paused, call: req({ key: 'payments', value: true, mode: 'auto' }), refuse: 'forbidden' },
    { name: 'auto pause, auto enables → allowed', pause: 'auto', current: paused, call: req({ key: 'payments', value: true, mode: 'auto' }), payments: true, after: null },
    { name: 'manual pause, manual enables → allowed', pause: 'manual', current: paused, call: req({ key: 'payments', value: true, mode: 'manual' }), payments: true, after: null },
    { name: 'auto pause, manual enables → allowed', pause: 'auto', current: paused, call: req({ key: 'payments', value: true, mode: 'manual' }), payments: true, after: null },
    { name: 'manual pause, auto pauses → manual stays', pause: 'manual', current: paused, call: req({ key: 'payments', value: false, mode: 'auto' }), payments: false, after: 'manual' },
  ];
  for (const row of rows) {
    it(row.name, () => {
      const check = checkToggle(row.current, row.pause, row.call);
      if (row.refuse) {
        expect(check).toEqual({ ok: false, refuse: row.refuse });
        return;
      }
      expect(check).toEqual({ ok: true });
      const next = applyToggle(row.current, row.pause, row.call);
      expect(next.switches.payments).toBe(row.payments);
      expect(next.paymentsPause).toBe(row.after);
    });
  }
  it('an auto pause on running payments records auto; a manual one records manual', () => {
    expect(applyToggle(on, null, req({ key: 'payments', value: false, mode: 'auto' }))).toEqual({ switches: paused, paymentsPause: 'auto' });
    expect(applyToggle(on, null, req({ key: 'payments', value: false, mode: 'manual' }))).toEqual({ switches: paused, paymentsPause: 'manual' });
    expect(applyToggle(paused, 'auto', req({ key: 'payments', value: false, mode: 'manual' })).paymentsPause).toBe('manual');
  });
});

describe('product choice (AC-19, AC-20)', () => {
  const list: CatalogProduct[] = [
    { id: 'p1', key: 'pass', price: { amount: 500, currency: 'USD' } },
    { id: 'p2', key: 'pass', price: { amount: 700, currency: 'USD' } },
    { id: 't2', key: 'toast:2', price: { amount: 200, currency: 'USD' } },
  ];
  it('takes the product price and grows priceVersion by one per key', () => {
    const first = chooseProduct(list, 'pass', 'p1', {});
    expect(first).toMatchObject({ ok: true, selection: { productId: 'p1', price: { amount: 500, currency: 'USD' }, priceVersion: 1 } });
    if (!first.ok) throw new Error('unreachable');
    const second = chooseProduct(list, 'pass', 'p2', first.selections);
    expect(second).toMatchObject({ ok: true, selection: { productId: 'p2', price: { amount: 700, currency: 'USD' }, priceVersion: 2 } });
  });
  it('refuses an unknown product', () => {
    expect(chooseProduct(list, 'pass', 'nope', {})).toEqual({ ok: false, refuse: 'unknown-product' });
  });
  it('refuses a product of another key', () => {
    expect(chooseProduct(list, 'pass', 't2', {})).toEqual({ ok: false, refuse: 'other-key' });
  });
  it('refuses everything with an empty port', () => {
    expect(chooseProduct([], 'pass', 'p1', {})).toEqual({ ok: false, refuse: 'unknown-product' });
  });
  it('clears a key', () => {
    const chosen = chooseProduct(list, 'pass', 'p1', {});
    if (!chosen.ok) throw new Error('unreachable');
    expect(clearProduct('pass', chosen.selections)).toEqual({});
  });
});

describe('snapshot assembly', () => {
  const meta = { generatedAt: '2026-11-01T00:00:00.000Z', tzdbVersion: '2026a' };
  it('the default record gives no products, every switch on and the catalog version', () => {
    const state = buildSnapshot({ record: DEFAULT_SITE_RECORD, patches: {}, catalogMeta: meta });
    expect(state).toEqual({
      version: 1,
      at: meta.generatedAt,
      switches: DEFAULT_SWITCHES,
      products: [],
      catalogVersion: '2026-11-01T00:00:00.000Z+2026a',
      eventPatches: {},
    });
  });
  it('lists the selections in key order and carries the patches', () => {
    const record = {
      ...DEFAULT_SITE_RECORD,
      version: 4,
      at: '2026-11-20T10:00:00.000Z',
      productSelections: {
        'toast:5': { productId: 't5', price: { amount: 500, currency: 'USD' as const }, priceVersion: 3 },
        pass: { productId: 'p1', price: { amount: 500, currency: 'USD' as const }, priceVersion: 1 },
      },
    };
    const state = buildSnapshot({ record, patches: { 'ev-1': { moment: 1_000, restrained: { note: 'n' } } }, catalogMeta: meta });
    expect(state.products.map((p) => p.key)).toEqual(['pass', 'toast:5']);
    expect(state.eventPatches).toEqual({ 'ev-1': { moment: 1_000, restrained: { note: 'n' } } });
    expect(state.at).toBe('2026-11-20T10:00:00.000Z');
    expect(technicalOf(state)).toEqual({ ...state, outage: 'technical' });
  });
});
