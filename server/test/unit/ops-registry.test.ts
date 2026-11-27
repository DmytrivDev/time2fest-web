/** SPEC-13b AC-24, AC-25, AC-29, AC-35 (data), AC-60: the «alarms and metrics» and spend registries. */
import { describe, expect, it } from 'vitest';
import { assertOpsRegistry, findKind, kindOf, opsRegistry, type OpsAlarmLevel, type OpsDomainRow } from '../../src/registries/ops';
import { assertSpendRegistry, spendRegistry } from '../../src/registries/spend';

/** The initial table of the spec (`docs/specs/SPEC-13b-ops.md`, «Початкові рядки реєстру»), with `source` / `code` as raised. */
const SPEC_TABLE: [domain: string, source: string, code: string, level: OpsAlarmLevel][] = [
  ['clock', 'clock', 'edge-divergence', 'page'],
  ['clock', 'clock', 'edge-divergence-warn', 'log'],
  ['clock', 'clock', 'refresh_failed', 'log'],
  ['scheduler', 'scheduler', 'lag', 'page'],
  ['scheduler', 'scheduler', 'lease_unreachable', 'page'],
  ['scheduler', 'scheduler', 'moments_load_failed', 'log'],
  ['scheduler', 'scheduler', 'action_failed', 'log'],
  ['catalog', 'catalog', 'catalog-r2-copy-failed', 'page'],
  ['site', 'site', 'site/r2-copy-failed', 'page'],
  ['site', 'site', 'site/rebuild-failed', 'page'],
  ['site', 'site', 'site/purge-failed', 'log'],
  ['site', 'site', 'site/publish-failed', 'log'],
  ['site', 'site', 'rebuild_tick_failed', 'log'],
  ['live', 'live', 'live/quota-80', 'page'],
  ['live', 'live', 'live/r2-copy-failed', 'page'],
  ['live', 'live', 'live/quota-exceeded', 'log'],
  ['live', 'live', 'live/override-kept', 'log'],
  ['live', 'live', 'live/purge-failed', 'log'],
  ['live', 'live', 'live/publish-failed', 'log'],
  ['live', 'live', 'poller_tick_failed', 'log'],
  ['live', 'live', 'viewers_tick_failed', 'log'],
  ['moderation', 'mod', 'provider_not_configured', 'page'],
  ['moderation', 'mod', 'moderation_throttled', 'page'],
  ['moderation', 'mod', 'moderation_saturated', 'page'],
  ['moderation', 'mod', 'moderation_fallback', 'page'],
  ['moderation', 'mod', 'spend_store_down', 'page'],
  ['moderation', 'mod', 'spend_80', 'page'],
  ['moderation', 'mod', 'spend_100', 'page'],
  ['moderation', 'mod', 'toasts_spend_80', 'page'],
  ['moderation', 'mod', 'moderation_rejected_requests', 'log'],
  ['moderation', 'mod', 'moderation_degraded', 'log'],
  ['moderation', 'mod', 'moderation_recovered', 'log'],
  ['moderation', 'mod', 'spend_store_recovered', 'log'],
  ['moderation', 'mod', 'spend_50', 'log'],
  ['moderation', 'mod', 'toasts_spend_50', 'log'],
  ['platform', 'access', 'access-jwks-unreachable', 'log'],
  ['platform', 'postgres', 'pool_client_error', 'log'],
  ['platform', 'events', 'listener_error', 'log'],
  ['platform', 'events', 'background_start_failed', 'log'],
  ['platform', 'unattended', 'tick_failed', 'log'],
  ['ops', 'ops', 'backup-failed', 'page'],
  ['ops', 'ops', 'backup-stale', 'page'],
  ['ops', 'ops', 'backup-not-configured', 'page'],
  ['ops', 'ops', 'unregistered-alarm', 'log'],
  ['ops', 'ops', 'heartbeat-fallback-window', 'log'],
  ['telegram', 'ops', 'telegram-delivery-failed', 'log'],
  ['telegram', 'ops', 'telegram-not-configured', 'log'],
  ['spend', 'spend', 'server-80', 'page'],
  ['spend', 'spend', 'cloudflare-80', 'page'],
  ['spend', 'spend', 'server-50', 'log'],
  ['spend', 'spend', 'cloudflare-50', 'log'],
  ['edge', 'edge', 'origin-down', 'page'],
  // SPEC-10 AC-46
  ['mail', 'mail', 'mail/daily-70', 'page'],
  ['mail', 'mail', 'mail/ceiling-80', 'page'],
  ['mail', 'mail', 'mail/provider-failover', 'page'],
  ['mail', 'mail', 'mail/all-providers-down', 'page'],
  ['mail', 'mail', 'mail/plan-free', 'page'],
  // SPEC-10 AC-24
  ['auth', 'auth', 'auth/link-retry', 'log'],
  // SPEC-14 AC-6, AC-64
  ['presence', 'presence', 'presence/fast-store-down', 'log'],
];

const DOMAINS = ['clock', 'scheduler', 'catalog', 'site', 'live', 'moderation', 'ops', 'telegram', 'spend', 'platform', 'mail', 'auth', 'presence'];
const RESERVED = ['edge', 'payments', 'chat', 'toasts'];

const alarm = { source: 'x', code: 'y', level: 'log' as const, meaning: 'Щось сталося.', action: 'Зробити щось.', detailKeys: ['a'] };
const row = (domain: string, over: Partial<OpsDomainRow> = {}): OpsDomainRow => ({ domain, title: 'Т', ownerWave: 'SPEC-00', alarms: [], metrics: [], ...over });

describe('ops registry (AC-24, AC-25)', () => {
  it('passes its own check: sorted, one row per domain', () => {
    expect(() => assertOpsRegistry(opsRegistry)).not.toThrow();
    const domains = opsRegistry.map((r) => r.domain);
    expect(domains).toEqual([...DOMAINS, ...RESERVED].sort());
  });

  it('failing fixtures throw: unsorted, duplicate domain, duplicate kind, empty or non-Ukrainian text, bad detail key', () => {
    expect(() => assertOpsRegistry([row('b'), row('a')])).toThrow(/out of order/);
    expect(() => assertOpsRegistry([row('a'), row('a')])).toThrow(/duplicate/);
    expect(() => assertOpsRegistry([row('a', { alarms: [alarm] }), row('b', { alarms: [alarm] })])).toThrow(/x\/y duplicate/);
    expect(() => assertOpsRegistry([row('a', { alarms: [{ ...alarm, meaning: '' }] })])).toThrow(/text/);
    expect(() => assertOpsRegistry([row('a', { alarms: [{ ...alarm, action: 'Do something' }] })])).toThrow(/Ukrainian/);
    expect(() => assertOpsRegistry([row('a', { alarms: [{ ...alarm, detailKeys: ['user_email'] }] })])).toThrow(/detail key/);
    expect(() => assertOpsRegistry([row('a', { reserved: true, metrics: [{ key: 'm', title: 'М' }] })])).toThrow(/pendingNote/);
    expect(() => assertOpsRegistry([row('a', { ownerWave: ' ' })])).toThrow(/ownerWave/);
  });

  it.each(SPEC_TABLE)('%s: %s/%s is registered as %s', (domain, source, code, level) => {
    const found = findKind(source, code);
    expect(found?.domain.domain).toBe(domain);
    expect(found?.alarm.level).toBe(level);
  });

  it('live/statuses-stale is one row describing both levels', () => {
    const found = findKind('live', 'live/statuses-stale');
    expect(found?.alarm.level).toBe('page');
    expect(found?.alarm.levelNote).toMatch(/page/);
    expect(found?.alarm.levelNote).toMatch(/log/);
  });

  it('AC-29: publish failures are log; skipped and rebuild gates are info; origin-down is reserved for SPEC-22a', () => {
    expect(findKind('site', 'site/publish-failed')?.alarm.level).toBe('log');
    expect(findKind('live', 'live/publish-failed')?.alarm.level).toBe('log');
    for (const [s, c] of [
      ['site', 'site/purge-skipped'],
      ['site', 'site/r2-copy-skipped'],
      ['live', 'live/purge-skipped'],
      ['live', 'live/r2-copy-skipped'],
      ['site', 'site/rebuild-frozen'],
      ['site', 'site/rebuild-disabled'],
      ['site', 'site/rebuild-not-configured'],
    ] as const) {
      expect(findKind(s, c)?.alarm.level, c).toBe('info');
    }
    const edge = findKind('edge', 'origin-down');
    expect(edge?.domain.reserved).toBe(true);
    expect(edge?.domain.ownerWave).toBe('SPEC-22a');
  });

  it('AC-35: reserved rows name their owner wave and every metric there is pending', () => {
    for (const name of RESERVED) {
      const r = opsRegistry.find((x) => x.domain === name);
      expect(r?.reserved, name).toBe(true);
      expect(r?.ownerWave, name).toMatch(/^SPEC-\d+[ab]?$/);
      expect(r?.metrics.length, name).toBeGreaterThan(0);
      for (const m of r?.metrics ?? []) expect(m.pendingNote, m.key).toBeTruthy();
    }
    for (const name of DOMAINS) expect(opsRegistry.find((x) => x.domain === name)?.reserved, name).toBeUndefined();
  });

  it('unknown kinds are not found; kindOf joins both code styles', () => {
    expect(findKind('ops', 'no-such-kind')).toBeUndefined();
    expect(kindOf({ source: 'live', code: 'live/quota-80' })).toBe('live/quota-80');
    expect(kindOf({ source: 'mod', code: 'spend_80' })).toBe('mod/spend_80');
  });
});

describe('spend registry (AC-60)', () => {
  it('passes its own check and has the five rows, sorted', () => {
    expect(() => assertSpendRegistry(spendRegistry)).not.toThrow();
    expect(spendRegistry.map((r) => r.key)).toEqual(['ai', 'cloudflare', 'mail', 'server', 'youtube']);
  });

  it('periods, ceilings and alarm owners follow [А18] and В2', () => {
    const by = new Map(spendRegistry.map((r) => [r.key, r]));
    expect(by.get('ai')?.period).toBe('night+month');
    expect(by.get('youtube')?.period).toBe('day');
    expect(by.get('mail')?.period).toBe('day');
    expect(by.get('mail')?.alarms).toBe(false);
    for (const k of ['cloudflare', 'server']) {
      expect(by.get(k)?.period, k).toBe('month');
      expect(by.get(k)?.ceiling.from, k).toBe('ops-settings');
      expect(by.get(k)?.alarms, k).toBe(true);
      for (const lvl of ['50', '80']) expect(findKind('spend', `${k}-${lvl}`), `${k}-${lvl}`).toBeDefined();
    }
    expect(by.get('ai')?.alarms).toBe(false);
    expect(by.get('cloudflare')?.note).toMatch(/нижня межа/);
  });

  it('failing fixtures throw', () => {
    const ok = spendRegistry[0]!;
    expect(() => assertSpendRegistry([spendRegistry[1]!, ok])).toThrow(/out of order/);
    expect(() => assertSpendRegistry([{ ...ok, source: 'from somewhere' }])).toThrow(/Ukrainian/);
    expect(() => assertSpendRegistry([{ ...ok, ceiling: { from: 'ops-settings', keys: [] } }])).toThrow(/ceiling/);
  });
});
