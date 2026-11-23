/** «Ефір» view (SPEC-12 AC-50): pure props → markup. */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LiveView, type LiveViewValue } from '../../src/admin/LiveView';
import { adminSlotRegistry } from '../../src/registries/adminSlots';

const source = (sourceId: string, extra: Record<string, unknown> = {}) => ({
  sourceId, videoId: `v-${sourceId}`, kind: 'live', label: `Канал ${sourceId}`, order: 0, status: 'live', served: 'live',
  override: null, hidden: false, dead: false, longNews: false, ...extra,
});

const view = {
  now: '2026-12-31T20:00:00.000Z',
  version: 3,
  slots: [
    { which: 'current', moment: '2026-12-31T21:00:00.000Z', events: [{ eventId: 'ev-1', zoneId: 'z1', zoneLiveUntil: null, sources: [source('s1'), source('s2', { hidden: true, label: '<b>x</b>' })] }] },
    { which: 'next', moment: '2026-12-31T22:00:00.000Z', events: [] },
  ],
  actions: ['hide', 'unhide', 'main', 'override', 'zone-live', 'replace'],
  quota: [
    { bucket: 'queries', used: 50, perDay: 200, ratio: 0.25, resetAt: '2027-01-01T07:00:00.000Z', percent: 25 },
    { bucket: 'search', used: 1, perDay: 100, ratio: 0.01, resetAt: '2027-01-01T07:00:00.000Z', percent: 1 },
    { bucket: 'batchGetStats', used: 0, perDay: 1000, ratio: 0, resetAt: '2027-01-01T07:00:00.000Z', percent: 0 },
  ],
} as unknown as LiveViewValue;

const html = () => renderToStaticMarkup(createElement(LiveView, { view }));

describe('LiveView', () => {
  it('shows both slots, the sources and the five actions', () => {
    const out = html();
    expect(out).toContain('Поточний слот');
    expect(out).toContain('Наступний слот');
    expect(out).toContain('Канал s1');
    for (const id of ['hide-s1', 'main-s1', 'override-s1', 'replace-s1', 'zone-live-ev-1']) expect(out).toContain(`data-testid="${id}"`);
  });

  it('offers unhide for a hidden source and renders a label as text', () => {
    const out = html();
    expect(out).toMatch(/data-testid="hide-s2"[^>]*>Показати</);
    expect(out).toContain('&lt;b&gt;x&lt;/b&gt;');
  });

  it('shows the three buckets with used, percent and the reset time in UTC', () => {
    const out = html();
    expect(out.match(/data-testid="quota-/g)).toHaveLength(3);
    expect(out).toContain('50 / 200 (25%)');
    expect(out).toContain('2027-01-01T07:00:00.000Z');
  });

  it('lists the slice in the admin slots after the corrections', () => {
    const keys = adminSlotRegistry.map((r) => r.key);
    expect(keys).toContain('15-live');
    expect(keys.indexOf('15-live')).toBe(keys.indexOf('10-corrections') + 1);
  });
});
