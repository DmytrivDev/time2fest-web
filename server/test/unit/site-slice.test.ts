/** «Стан сайту» view (SPEC-08 AC-17): pure props → markup. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SiteState } from '@time2fest/contracts';
import { SiteStateView, type SiteStateViewProps } from '../../src/admin/SiteStateView';
import { DEFAULT_SWITCHES } from '../../src/domain/site/switches';

const state: SiteState = {
  version: 7,
  at: '2026-11-20T10:00:00.000Z',
  switches: { ...DEFAULT_SWITCHES, chat: false, chatRooms: { 'room-ua': false }, toastTiers: { '2': true, '5': false, '10': true } },
  products: [],
  catalogVersion: 'cv1',
  eventPatches: {},
};

const base: SiteStateViewProps = { state, paymentsPause: 'manual', products: [], selections: {} };
const html = (props: SiteStateViewProps) => renderToStaticMarkup(createElement(SiteStateView, props));

const fake = [
  { id: 'pass-a', key: 'pass' as const, price: { amount: 500, currency: 'USD' } },
  { id: 'pass-b', key: 'pass' as const, price: { amount: 600, currency: 'USD' } },
  { id: 't2', key: 'toast:2' as const, price: { amount: 200, currency: 'USD' } },
  { id: 't5', key: 'toast:5' as const, price: { amount: 500, currency: 'USD' } },
  { id: 't10', key: 'toast:10' as const, price: { amount: 1000, currency: 'USD' } },
];

describe('SiteStateView', () => {
  it('shows exactly the empty-port text and no select when the products port is empty', () => {
    const out = html(base);
    expect(out).toContain('Товарів ще немає — ціни з’являться після підключення PayPro (SPEC-17)');
    expect(out).not.toContain('<select');
  });

  it('shows one select per product key with its options when the port lists products', () => {
    const out = html({ ...base, products: fake, selections: { pass: { productId: 'pass-b' } } });
    expect(out).not.toContain('Товарів ще немає');
    expect(out.match(/<select/g)).toHaveLength(4);
    for (const key of ['pass', 'toast:2', 'toast:5', 'toast:10']) expect(out).toContain(`data-testid="product-${key}"`);
    expect(out).toContain('pass-a — $5.00');
    expect(out).toContain('pass-b — $6.00');
    expect(out).toMatch(/<option value="pass-b" selected/);
  });

  it('renders nine switch rows with values, rooms and tiers', () => {
    const out = html(base);
    const rows = out.match(/data-testid="switch-[A-Za-z]+"/g) ?? [];
    expect(rows).toHaveLength(9);
    expect(out).toContain('Чат: вимкнено');
    expect(out).toContain('room-ua — вимкнено');
    expect(out).toContain('$5: вимкнено');
    expect(out).toContain('$2: увімкнено');
  });

  it('shows the payments pause mode', () => {
    expect(html(base)).toContain('Пауза платежів: вручну');
    expect(html({ ...base, paymentsPause: 'auto' })).toContain('Пауза платежів: автоматично');
    expect(html({ ...base, paymentsPause: null })).toContain('Пауза платежів: немає');
  });

  it('shows a message as text, never as markup', () => {
    const out = html({ ...base, message: '<img src=x onerror=alert(1)>', reason: '<b>x</b>' });
    expect(out).not.toContain('<img');
    expect(out).not.toContain('<b>x</b>');
  });
});
