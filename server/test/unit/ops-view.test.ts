/** «Моніторинг» view and overview (SPEC-13b AC-23, AC-33, AC-35, AC-36, AC-37, AC-60, AC-65): fixture data → markup, pure. */
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { OpsView } from '../../src/admin/OpsView';
import { OPS_TEXT } from '../../src/admin/messages';
import { buildOverview, telegramBlock, type OverviewSources } from '../../src/ops/overview';
import { BLOCK_KEYS, OverviewSchema, OVERVIEW_MAX_BYTES } from '../../src/ops/overviewSchema';
import { opsRegistry } from '../../src/registries/ops';

const NOW = Date.UTC(2026, 11, 31, 20, 0, 0);
const HOUR = 3_600_000;

const sources = (over: Partial<OverviewSources> = {}): OverviewSources => ({
  now: () => NOW,
  env: 'test',
  openPageAlarms: async () => [
    { id: '1', source: 'catalog', code: 'catalog-r2-copy-failed', level: 'page', raisedAt: NOW - 1000, acknowledgedAt: null },
    { id: '2', source: 'mystery', code: 'x', level: 'page', raisedAt: NOW - 5000, acknowledgedAt: null },
  ],
  logAlarms: async () => [
    { id: 'l1', source: 'ops', code: 'telegram-not-configured', details: null, raisedAt: NOW - 3 * HOUR },
    { id: 'l2', source: 'ops', code: 'telegram-not-configured', details: null, raisedAt: NOW - HOUR },
    { id: 'l3', source: 'mystery', code: 'y', details: null, raisedAt: NOW - 2 * HOUR },
  ],
  time: async () => ({ edgeSkewMs: 300, virtual: false, speed: 1 }),
  scheduler: async () => ({ holder: 'h1', epoch: 2, lagMs: 100, renewedAgeMs: 900, missed24h: 0 }),
  catalog: async () => ({ seasonKey: '2027', generatedAt: '2026-11-01T00:00:00.000Z', r2LastOkAt: NOW - HOUR, r2LastFailedAt: null }),
  site: async () => ({ version: 4, outage: false, paymentsPause: null, switches: { chat: true, toasts: false } }),
  live: async () => ({ version: 3, quota: [{ bucket: 'queries', used: 50, perDay: 200, percent: 25 }], sources: { total: 3, dead: 1, hidden: 0 } }),
  moderation: async () => ({
    tasks: [{ task: 'moderation', state: 'ok', reason: null }],
    providers: [{ provider: 'p1', task: 'moderation', status: 'ok' }],
    night: { usd: 1, ceilingUsd: 50, percent: 2 },
    month: { usd: 10, ceilingUsd: 100, percent: 10 },
  }),
  backups: async () => ({ last: { at: NOW - HOUR, result: 'ok', kind: 'hourly', stage: null, size: 2_097_152 }, lastOk: { at: NOW - HOUR, size: 2_097_152 }, lastRestore: null }),
  telegram: async () => ({ status: 'configured', lastDeliveredAt: NOW - 30 * 60_000, zones: null }),
  spend: async () => [
    { key: 'ai', title: 'AI', unit: 'usd', amount: 10, ceiling: 100, percent: 10, state: 'ok' },
    { key: 'cloudflare', title: 'Cloudflare', unit: 'usd', amount: 0, ceiling: 10, percent: 0, state: 'ok' },
    { key: 'mail', title: 'Mail', unit: 'usd', amount: null, ceiling: null, percent: null, state: 'no-provider' },
  ],
  ...over,
});

const html = async (over: Partial<OverviewSources> = {}) => renderToStaticMarkup(createElement(OpsView, { overview: await buildOverview(sources(over)) }));

describe('overview and OpsView', () => {
  it('AC-37: every block has its data-testid and every alarm row its own', async () => {
    const out = await html();
    for (const id of ['alarms', 'log-alarms', 'time', 'scheduler', 'catalog', 'site', 'live', 'moderation', 'backups', 'telegram', 'spend', 'pending']) {
      expect(out, id).toContain(`data-testid="ops-${id}"`);
    }
    expect(out).toContain('data-testid="ops-alarm-1"');
    expect(out).toContain('data-testid="ops-ack-2"');
  });

  it('AC-23: Telegram turns red after 70 minutes without a delivered heartbeat inside the window, not before', () => {
    const zones = { zones: [{ midnightMs: NOW }] };
    expect(telegramBlock({ status: 'configured', lastDeliveredAt: NOW - 69 * 60_000, zones }, NOW).red).toBe(false);
    expect(telegramBlock({ status: 'configured', lastDeliveredAt: NOW - 71 * 60_000, zones }, NOW).red).toBe(true);
    // Outside the window silence is not an alarm; without a sink there is nothing to be red about.
    expect(telegramBlock({ status: 'configured', lastDeliveredAt: null, zones }, NOW + 40 * 24 * HOUR).red).toBe(false);
    expect(telegramBlock({ status: 'not-configured', lastDeliveredAt: null, zones }, NOW).red).toBe(false);
  });

  it('AC-23: the red class is on the Telegram block', async () => {
    const out = await html({ telegram: async () => ({ status: 'configured', lastDeliveredAt: NOW - 90 * 60_000, zones: { zones: [{ midnightMs: NOW }] } }) });
    expect(out).toMatch(/<section data-testid="ops-telegram" class="ops-red">/);
    expect(await html()).not.toMatch(/data-testid="ops-telegram" class="ops-red"/);
  });

  it('AC-33: log alarms are grouped by domain and kind with a count and the last time', async () => {
    const o = await buildOverview(sources());
    const groups = o.blocks.logAlarms?.groups ?? [];
    expect(groups).toHaveLength(2);
    const ops = groups.find((g) => g.kind === 'ops/telegram-not-configured');
    expect(ops?.count).toBe(2);
    expect(ops?.lastAt).toBe(new Date(NOW - HOUR).toISOString());
    expect(groups.find((g) => g.kind === 'mystery/y')?.domain).toBeNull();
  });

  it('AC-35: pending rows are exactly the reserved metrics of the registry, each with its owner wave', async () => {
    const o = await buildOverview(sources());
    const expected = opsRegistry.flatMap((d) => d.metrics.filter((m) => m.pendingNote).map((m) => m.key)).sort();
    expect(o.blocks.pending?.rows.map((r) => r.metricKey).sort()).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
    for (const r of o.blocks.pending?.rows ?? []) expect(r.ownerWave).toMatch(/^SPEC-/);
    const out = await html();
    expect(out).toContain(OPS_TEXT.noData);
  });

  it('AC-60, AC-65: spend rows with percent; cloudflare is labelled a lower bound; mail has no provider', async () => {
    const out = await html();
    expect(out).toContain('data-testid="ops-spend-ai"');
    expect(out).toContain(OPS_TEXT.cloudflareFloor);
    expect(out).toContain(OPS_TEXT.noProvider);
    expect(out).toContain('(10%)');
  });

  it('AC-56: no restore yet → «ще не заміряно»', async () => {
    expect(await html()).toContain(OPS_TEXT.notMeasured);
  });

  it('AC-31: a failing provider gives errors [block], a null block and a placeholder; the rest is filled', async () => {
    const o = await buildOverview(sources({ live: async () => Promise.reject(new Error('boom')) }));
    expect(o.errors).toEqual(['live']);
    expect(o.blocks.live).toBeNull();
    expect(o.blocks.site).not.toBeNull();
    expect(renderToStaticMarkup(createElement(OpsView, { overview: o }))).toContain('data-testid="ops-live-error"');
    expect(OverviewSchema.safeParse(o).success).toBe(true);
  });

  it('AC-36: a big sample is trimmed to ≤ 64 KB and still valid', async () => {
    const many = Array.from({ length: 100 }, (_, i) => ({ id: String(i), source: `src${i}`, code: 'c'.repeat(100), level: 'page' as const, raisedAt: NOW - i, acknowledgedAt: null }));
    const logs = Array.from({ length: 3000 }, (_, i) => ({ id: `l${i}`, source: `s${i}`, code: 'k'.repeat(40), details: null, raisedAt: NOW - i }));
    const o = await buildOverview(sources({ openPageAlarms: async () => many, logAlarms: async () => logs }));
    expect(Buffer.byteLength(JSON.stringify(o), 'utf8')).toBeLessThanOrEqual(OVERVIEW_MAX_BYTES);
    expect(OverviewSchema.safeParse(o).success).toBe(true);
    expect(o.blocks.alarms?.total).toBe(100);
    expect(Object.keys(o.blocks)).toEqual([...BLOCK_KEYS]);
  });

  it('AC-37: no Ukrainian string literals in OpsView, OpsSlice or overview outside messages.ts', () => {
    for (const file of ['src/admin/OpsView.tsx', 'src/admin/OpsSlice.tsx', 'src/ops/overview.ts']) {
      const code = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split(/\r?\n/) // CRLF checkout on Windows: `.` does not match `\r`, so a trailing `// …` would survive
        .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
        .join('\n');
      expect(/[Ѐ-ӿ]/.test(code), file).toBe(false);
    }
  });
});
