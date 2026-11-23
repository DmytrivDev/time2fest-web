/** Live domain rules (SPEC-12 AC-8, AC-10, AC-25 … AC-30, AC-57, AC-58, AC-74), without a database. */
import { describe, expect, it } from 'vitest';
import { streamSources } from '../../src/collections/streamSources';
import { LIVE_DEFAULTS, parseLiveConfig, type LiveConfig } from '../../src/domain/live/config';
import { publicChain, publicChains, servedStatus, type StoredSource } from '../../src/domain/live/chain';
import { isWindowOpen, liveEventOf, openWindowEvents, type LiveEvent } from '../../src/domain/live/moment';
import { batchesOf, nextOffWindowCheckAt, planTick, type ScheduledSource } from '../../src/domain/live/schedule';
import { publishedStatus, statusFromCheck } from '../../src/domain/live/status';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const cfg = LIVE_DEFAULTS;
const T0 = Date.parse('2026-12-31T23:00:00Z');
const withCfg = (over: Partial<LiveConfig>): LiveConfig => ({ ...cfg, ...over });

const event = (over: Partial<LiveEvent> = {}): LiveEvent => ({ eventId: 'e1', zoneId: 'utc+0100', moment: T0, nonMidnight: false, hidden: false, ...over });
const source = (over: Partial<StoredSource> = {}): StoredSource => ({
  sourceId: 's1',
  eventId: 'e1',
  platform: 'youtube',
  videoId: 'vid1',
  kind: 'main',
  name: 'Головне',
  order: 0,
  status: 'live',
  embeddable: true,
  privacyStatus: 'public',
  ytFetchedAt: T0 - MIN,
  lastChecked: T0 - MIN,
  ...over,
});
const ctx = (now: number, over: Partial<LiveConfig> = {}) => ({ now, cfg: withCfg(over) });

describe('model (AC-8)', () => {
  const names = new Set(streamSources.fields.map((f) => ('name' in f ? f.name : '')));
  it('stores every FR-LIVE-02 field', () => {
    for (const n of ['platform', 'kind', 'label', 'name', 'order', 'startsAt', 'status', 'embeddable', 'lastChecked', 'override', 'rights', 'evidence', 'geo']) {
      expect(names.has(n), n).toBe(true);
    }
  });
  it('accepts the four platforms in the model', () => {
    const platform = streamSources.fields.find((f) => 'name' in f && f.name === 'platform');
    expect(platform && 'options' in platform ? platform.options : []).toEqual(['youtube', 'iframe-official', 'hls', 'none']);
  });
  it('serves only youtube: hls, iframe-official and none never reach the public chain', () => {
    for (const platform of ['hls', 'iframe-official', 'none'] as const) {
      expect(servedStatus(source({ platform }), event(), ctx(T0))).toBeNull();
    }
    expect(publicChain(event(), [source({ platform: 'hls', sourceId: 'h' }), source()], ctx(T0))?.sources.map((s) => s.id)).toEqual(['s1']);
  });
});

describe('moment and window (AC-10, AC-58)', () => {
  it('uses startsAt for a non-midnight slot and midnightUtc otherwise, with the correction applied', () => {
    expect(liveEventOf({ eventId: 'p', zoneId: 'z', slot: 'dawn', midnightUtc: '2026-12-31T23:00:00Z', startsAt: '2026-12-31T22:50:00Z' })?.moment).toBe(
      Date.parse('2026-12-31T22:50:00Z'),
    );
    expect(liveEventOf({ eventId: 'm', zoneId: 'z', midnightUtc: '2026-12-31T23:00:00Z' })?.moment).toBe(T0);
    expect(liveEventOf({ eventId: 'm', zoneId: 'z', midnightUtc: '2026-12-31T23:00:00Z', patch: { moment: T0 + 7 * MIN, hidden: false } })?.moment).toBe(T0 + 7 * MIN);
    expect(liveEventOf({ eventId: 'x', zoneId: 'z', slot: 'dawn', midnightUtc: '2026-12-31T23:00:00Z' })).toBeNull();
  });
  it('opens the window from −1 h inclusive to +1 h exclusive', () => {
    expect(isWindowOpen(T0, T0 - HOUR - 1, cfg)).toBe(false);
    expect(isWindowOpen(T0, T0 - HOUR, cfg)).toBe(true);
    expect(isWindowOpen(T0, T0 + HOUR - 1, cfg)).toBe(true);
    expect(isWindowOpen(T0, T0 + HOUR, cfg)).toBe(false);
    expect(isWindowOpen(T0, T0 - HOUR, withCfg({ windowBeforeMs: HOUR / 2 }))).toBe(false);
    expect(isWindowOpen(T0, T0 + HOUR, withCfg({ windowAfterMs: 2 * HOUR }))).toBe(true);
  });
  it('a hidden event has no window, no chain and its ids are never asked', () => {
    const hidden = liveEventOf({ eventId: 'e1', zoneId: 'z', midnightUtc: '2026-12-31T23:00:00Z', patch: { moment: null, hidden: true } })!;
    expect(openWindowEvents([hidden], T0, cfg)).toEqual([]);
    expect(publicChains([hidden], [source()], ctx(T0))).toEqual([]);
    expect(planTick([hidden], [{ eventId: 'e1', videoId: 'vid1' }], T0, cfg).batches).toEqual([]);
  });
  it('a non-midnight event carries its own moment as startsAt and is polled around it', () => {
    const paris = event({ eventId: 'e1', moment: Date.parse('2026-12-31T22:50:00Z'), nonMidnight: true });
    const chain = publicChain(paris, [source()], ctx(paris.moment))!;
    expect(chain.sources[0]?.startsAt).toBe('2026-12-31T22:50:00.000Z');
    const src: ScheduledSource[] = [{ eventId: 'e1', videoId: 'vid1', nextOffWindowCheckAt: Infinity }];
    expect(planTick([paris], src, Date.parse('2026-12-31T21:49:59Z'), cfg).windowIds).toEqual([]);
    expect(planTick([paris], src, Date.parse('2026-12-31T21:50:00Z'), cfg).windowIds).toEqual(['vid1']);
    expect(planTick([paris], src, Date.parse('2026-12-31T23:50:00Z'), cfg).windowIds).toEqual([]);
  });
});

describe('batching (AC-25)', () => {
  const ids = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix}${i}`);
  const overlapping = [event({ eventId: 'a' }), event({ eventId: 'b', moment: T0 + 15 * MIN }), event({ eventId: 'c', moment: T0 + 30 * MIN })];
  const sourcesOf = (all: string[]): ScheduledSource[] => all.map((videoId, i) => ({ eventId: ['a', 'b', 'c'][i % 3]!, videoId, nextOffWindowCheckAt: Infinity }));

  it('three overlapping windows, 30 ids → 1 call', () => {
    expect(planTick(overlapping, sourcesOf(ids('v', 30)), T0, cfg).batches).toHaveLength(1);
  });
  it('75 ids → 2 calls of at most B', () => {
    const plan = planTick(overlapping, sourcesOf(ids('v', 75)), T0, cfg);
    expect(plan.batches.map((b) => b.length)).toEqual([50, 25]);
  });
  it('the same id in two windows is counted once', () => {
    const plan = planTick(overlapping, [
      { eventId: 'a', videoId: 'shared', nextOffWindowCheckAt: Infinity },
      { eventId: 'b', videoId: 'shared', nextOffWindowCheckAt: Infinity },
    ], T0, cfg);
    expect(plan.windowIds).toEqual(['shared']);
    expect(plan.batches).toEqual([['shared']]);
  });
  it('B comes from the configuration', () => {
    expect(planTick(overlapping, sourcesOf(ids('v', 30)), T0, withCfg({ batchSize: 10 })).batches).toHaveLength(3);
    expect(batchesOf(ids('v', 5), 2).map((b) => b.length)).toEqual([2, 2, 1]);
  });
});

describe('off-window checks (AC-26)', () => {
  it('over 14 days of test clock, intervals between checks of a source stay within [6 h, 7 days]', () => {
    const far = event({ moment: Date.parse('2027-03-01T00:00:00Z') });
    const src: ScheduledSource = { eventId: 'e1', videoId: 'vid1', nextOffWindowCheckAt: null };
    const start = Date.parse('2026-12-01T03:17:00Z');
    const checks: number[] = [];
    for (let now = start; now <= start + 14 * DAY; now += cfg.tickMs) {
      const plan = planTick([far], [src], now, cfg);
      if (plan.offWindowIds.includes('vid1')) {
        checks.push(now);
        src.nextOffWindowCheckAt = nextOffWindowCheckAt(now, cfg);
      }
    }
    expect(checks.length).toBeGreaterThan(14 * 2);
    for (let i = 1; i < checks.length; i++) {
      const gap = checks[i]! - checks[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(cfg.offWindowMinMs);
      expect(gap).toBeLessThanOrEqual(cfg.offWindowMaxMs);
    }
  });
  it('the next check is on the shared grid, never sooner than min, never later than max', () => {
    const at = Date.parse('2026-12-31T13:05:00Z');
    expect(new Date(nextOffWindowCheckAt(at, cfg)).toISOString()).toBe('2027-01-01T00:00:00.000Z');
    const wide = withCfg({ offWindowMinMs: 3 * DAY, offWindowMaxMs: 4 * DAY });
    const n = nextOffWindowCheckAt(at, wide);
    expect(n - at).toBeGreaterThanOrEqual(3 * DAY);
    expect(n - at).toBeLessThanOrEqual(4 * DAY);
    expect(nextOffWindowCheckAt(at, withCfg({ offWindowMinMs: 5 * DAY, offWindowMaxMs: 5 * DAY + 1 })) - at).toBeLessThanOrEqual(5 * DAY + 1);
  });
  it('an id in an open window is not also checked off-window', () => {
    const plan = planTick([event()], [{ eventId: 'e1', videoId: 'vid1', nextOffWindowCheckAt: null }], T0, cfg);
    expect(plan.windowIds).toEqual(['vid1']);
    expect(plan.offWindowIds).toEqual([]);
  });
});

describe('YouTube state → status, table [А20] (AC-27, AC-29)', () => {
  const base = { videoId: 'v', privacyStatus: 'public', embeddable: true };
  it.each([
    ['live', { ...base, liveBroadcastContent: 'live' }, { kind: 'alive', status: 'live' }],
    [
      'upcoming in the future',
      { ...base, liveBroadcastContent: 'upcoming', scheduledStartTime: '2026-12-31T23:10:00Z' },
      { kind: 'alive', status: 'expected', startsAt: '2026-12-31T23:10:00.000Z' },
    ],
    ['upcoming passed', { ...base, liveBroadcastContent: 'upcoming', scheduledStartTime: '2026-12-31T22:59:00Z' }, { kind: 'alive', status: 'possible' }],
    ['none after actualEndTime', { ...base, liveBroadcastContent: 'none', actualEndTime: '2026-12-31T22:00:00Z' }, { kind: 'dead', reason: 'ended' }],
    ['private', { ...base, privacyStatus: 'private', liveBroadcastContent: 'live' }, { kind: 'dead', reason: 'private' }],
    ['unlisted', { ...base, privacyStatus: 'unlisted', liveBroadcastContent: 'live' }, { kind: 'dead', reason: 'private' }],
    ['not embeddable', { ...base, embeddable: false, liveBroadcastContent: 'live' }, { kind: 'dead', reason: 'not-embeddable' }],
  ])('%s', (_name, video, expected) => {
    expect(statusFromCheck(video, T0)).toEqual(expected);
  });
  it('deleted (absent from the answer) → dead', () => {
    expect(statusFromCheck(undefined, T0)).toEqual({ kind: 'dead', reason: 'missing' });
  });
  it('a non-public or non-embeddable stored source is not served', () => {
    expect(servedStatus(source({ embeddable: false }), event(), ctx(T0))).toBeNull();
    expect(servedStatus(source({ privacyStatus: 'private' }), event(), ctx(T0))).toBeNull();
    expect(servedStatus(source({ embeddable: null }), event(), ctx(T0))).toBeNull();
  });
});

describe('−5 min rule (AC-28)', () => {
  it('expected without startsAt is published as possible from 5 min before the moment', () => {
    expect(publishedStatus('expected', null, T0, T0 - 5 * MIN - 30_000, cfg)).toBe('expected');
    expect(publishedStatus('expected', null, T0, T0 - 5 * MIN, cfg)).toBe('possible');
    expect(publishedStatus('expected', '2026-12-31T23:00:00Z', T0, T0 - MIN, cfg)).toBe('expected');
    expect(publishedStatus('expected', null, T0, T0 - 5 * MIN - 30_000, withCfg({ possibleBeforeMs: 6 * MIN }))).toBe('possible');
  });
});

describe('chain: dead, override, zone-live (AC-9, AC-30)', () => {
  const two = [source(), source({ sourceId: 's2', videoId: 'vid2', order: 1 })];
  it('a dead first source leaves the next one first; all dead → empty chain', () => {
    expect(publicChain(event(), [{ ...two[0]!, dead: true }, two[1]!], ctx(T0))?.sources.map((s) => s.id)).toEqual(['s2']);
    expect(publicChain(event(), two.map((s) => ({ ...s, dead: true })), ctx(T0))).toEqual({ eventId: 'e1', sources: [] });
  });
  it('orders by order, then sourceId', () => {
    expect(publicChain(event(), [two[1]!, two[0]!], ctx(T0))?.sources.map((s) => s.id)).toEqual(['s1', 's2']);
  });
  it('override live wins over the poller; override ended or hidden removes the source', () => {
    const s = publicChain(event(), [source({ dead: true, status: null, override: 'live' })], ctx(T0))!.sources[0]!;
    expect(s.status).toBe('live');
    expect(s.override).toBe(true);
    expect(servedStatus(source({ override: 'ended' }), event(), ctx(T0))).toBeNull();
    expect(servedStatus(source({ override: 'hidden' }), event(), ctx(T0))).toBeNull();
    expect(servedStatus(source({ hidden: true }), event(), ctx(T0))).toBeNull();
  });
  it('zone-live makes sources live until its until', () => {
    const z = { 'utc+0100': { until: T0 + HOUR } };
    expect(servedStatus(source({ status: 'possible' }), event(), { ...ctx(T0), zoneLive: z })).toBe('live');
    expect(servedStatus(source({ status: 'possible' }), event(), { ...ctx(T0 + HOUR), zoneLive: z })).toBe('possible');
  });
  it('the wire source matches the contract', () => {
    const s = publicChain(event(), [source()], ctx(T0))!.sources[0]!;
    expect(s).toMatchObject({ id: 's1', platform: 'youtube', videoId: 'vid1', url: 'https://www.youtube.com/watch?v=vid1', kind: 'main', title: { uk: 'Головне' }, isLive: true, embeddable: true });
    expect(s.startsAt).toBeUndefined();
  });
});

describe('retention (AC-74)', () => {
  it('a fetch older than 30 days is not served; a fresh one is', () => {
    expect(servedStatus(source({ ytFetchedAt: T0 - 30 * DAY }), event(), ctx(T0))).toBe('live');
    expect(servedStatus(source({ ytFetchedAt: T0 - 30 * DAY - 1 }), event(), ctx(T0))).toBeNull();
    expect(servedStatus(source({ ytFetchedAt: T0 - 2 * DAY }), event(), ctx(T0, { retentionMs: DAY }))).toBeNull();
  });
});

describe('long news (AC-57)', () => {
  const news = source({ longNews: true });
  const at = (offset: number, e = event(), over: Partial<LiveConfig> = {}) => servedStatus(news, e, ctx(e.moment + offset, over));
  it('served from −20:00 inclusive to +15:00 exclusive', () => {
    expect(at(-20 * MIN - 1_000)).toBeNull();
    expect(at(-20 * MIN)).toBe('live');
    expect(at(14 * MIN + 59_000)).toBe('live');
    expect(at(15 * MIN)).toBeNull();
  });
  it('the bounds follow a patched moment (SPEC-08)', () => {
    const patched = liveEventOf({ eventId: 'e1', zoneId: 'utc+0100', midnightUtc: '2026-12-31T23:00:00Z', patch: { moment: T0 + 10 * MIN, hidden: false } })!;
    expect(at(-20 * MIN - 1_000, patched)).toBeNull();
    expect(at(-20 * MIN, patched)).toBe('live');
    expect(at(14 * MIN + 59_000, patched)).toBe('live');
    expect(at(15 * MIN, patched)).toBeNull();
    expect(servedStatus(news, patched, ctx(T0 - 15 * MIN))).toBeNull();
  });
  it('the bounds come from the configuration', () => {
    expect(at(-20 * MIN, event(), { longNewsBeforeMs: 10 * MIN })).toBeNull();
    expect(at(15 * MIN, event(), { longNewsAfterMs: 20 * MIN })).toBe('live');
  });
});

describe('parseLiveConfig', () => {
  it('absent → defaults; partial JSON merges deep; bad keys are named', () => {
    expect(parseLiveConfig(undefined)).toEqual({ ok: true, config: LIVE_DEFAULTS });
    const r = parseLiveConfig('{"reserve":2000,"buckets":{"search":{"perDay":7}}}');
    expect(r.ok && r.config.reserve).toBe(2000);
    expect(r.ok && r.config.buckets.search).toEqual({ perDay: 7, perMinute: LIVE_DEFAULTS.buckets.search.perMinute });
    expect(r.ok && r.config.buckets.queries).toEqual(LIVE_DEFAULTS.buckets.queries);
    expect(parseLiveConfig('{"reserve":-1}')).toEqual({ ok: false, failing: ['T2F_LIVE_CONFIG.reserve'] });
    expect(parseLiveConfig('{"unknown":1}').ok).toBe(false);
    expect(parseLiveConfig('{"dayTimeZone":"Nowhere/City"}').ok).toBe(false);
    expect(parseLiveConfig('not json')).toEqual({ ok: false, failing: ['T2F_LIVE_CONFIG'] });
  });
});
