/** Live quota rules (SPEC-12 AC-31 … AC-34, AC-36, AC-37, AC-40, AC-44), without a database or a network. */
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS, type LiveConfig } from '../../src/domain/live/config';
import {
  allow,
  allowedClasses,
  charge,
  chargeCalls,
  counterOf,
  inQueueOrder,
  markExceeded,
  nextDayBoundary,
  QUOTA_CLASSES,
  quotaDay,
  staleLevel,
  type CallerContext,
  type QuotaState,
} from '../../src/domain/live/quota';

const cfg = LIVE_DEFAULTS;
const fake: CallerContext = { envClass: 'production', adapter: 'fake' };
const rehearsalReal: CallerContext = { envClass: 'rehearsal', adapter: 'real' };
const at = (iso: string) => Date.parse(iso);
const NOW = at('2026-12-31T20:00:00Z');
const MIN = 60_000;
const withCfg = (over: Partial<LiveConfig>): LiveConfig => ({ ...cfg, ...over });
const used = (n: number, now = NOW, c: LiveConfig = cfg, key: 'queries' | 'search' | 'ad-hoc' = 'queries'): QuotaState => ({
  [key]: { ...counterOf({}, key, now, c), used: n },
});

describe('quota day (AC-31)', () => {
  it('07:59:59 and 08:00:00 UTC on 01.01 fall in different days', () => {
    expect(quotaDay(at('2027-01-01T07:59:59Z'), cfg.dayTimeZone)).toBe('2026-12-31');
    expect(quotaDay(at('2027-01-01T08:00:00Z'), cfg.dayTimeZone)).toBe('2027-01-01');
  });
  it('the next boundary is local midnight, across both DST changes', () => {
    expect(new Date(nextDayBoundary(NOW, cfg.dayTimeZone)).toISOString()).toBe('2027-01-01T08:00:00.000Z');
    expect(new Date(nextDayBoundary(at('2027-03-14T12:00:00Z'), cfg.dayTimeZone)).toISOString()).toBe('2027-03-15T07:00:00.000Z');
    expect(new Date(nextDayBoundary(at('2027-11-07T12:00:00Z'), cfg.dayTimeZone)).toISOString()).toBe('2027-11-08T08:00:00.000Z');
    expect(quotaDay(at('2027-03-15T06:59:59Z'), cfg.dayTimeZone)).toBe('2027-03-14');
  });
  it('charges in different days land in different counters', () => {
    let s: QuotaState = {};
    s = charge(s, 'queries', 1, at('2027-01-01T07:59:59Z'), cfg).state;
    expect(counterOf(s, 'queries', at('2027-01-01T07:59:59Z'), cfg).used).toBe(1);
    s = charge(s, 'queries', 1, at('2027-01-01T08:00:00Z'), cfg).state;
    expect(counterOf(s, 'queries', at('2027-01-01T08:00:00Z'), cfg)).toMatchObject({ day: '2027-01-01', used: 1 });
  });
  it('a failed call (400 from the fake) is still counted at least 1', () => {
    expect(counterOf(charge({}, 'queries', 0, NOW, cfg).state, 'queries', NOW, cfg).used).toBe(1);
    expect(counterOf(charge({}, 'search', 0, NOW, cfg).state, 'search', NOW, cfg).used).toBe(1);
  });
});

describe('reserve and class order (AC-32)', () => {
  it('with 999 left only open-window statuses run', () => {
    expect(allowedClasses(used(10_000 - 999), NOW, cfg, fake)).toEqual(['statuses']);
    expect(allow(used(10_000 - 999), 'ad-hoc', NOW, cfg, fake)).toEqual({ ok: false, reason: 'reserve' });
  });
  it('with 5 000 left every class runs, in the FR-LIVE-12 order', () => {
    expect(allowedClasses(used(5_000), NOW, cfg, fake)).toEqual(['statuses', 'ad-hoc', 'candidates', 'playlists', 'search', 'off-window']);
    const queue = inQueueOrder([{ cls: 'search' as const }, { cls: 'playlists' as const }, { cls: 'statuses' as const }, { cls: 'candidates' as const }, { cls: 'off-window' as const }, { cls: 'ad-hoc' as const }]);
    expect(queue.map((r) => r.cls)).toEqual([...QUOTA_CLASSES]);
  });
  it('statuses stop only at the day limit', () => {
    expect(allow(used(9_999), 'statuses', NOW, cfg, fake).ok).toBe(true);
    expect(allow(used(10_000), 'statuses', NOW, cfg, fake)).toEqual({ ok: false, reason: 'quota-exhausted' });
  });
});

describe('search ceiling (AC-33)', () => {
  it('the 101st search is refused quota-exhausted before any request', () => {
    expect(allow(used(99, NOW, cfg, 'search'), 'search', NOW, cfg, fake)).toEqual({ ok: true, bucket: 'search', units: 1 });
    expect(allow(used(100, NOW, cfg, 'search'), 'search', NOW, cfg, fake)).toEqual({ ok: false, reason: 'quota-exhausted' });
  });
});

describe('80 % alarm (AC-34)', () => {
  it('8 000 → one alarm, 8 500 → none, a new day → again', () => {
    let s: QuotaState = used(7_999);
    const first = charge(s, 'queries', 1, NOW, cfg);
    expect(first.alarm).toEqual({ code: 'live/quota-80', level: 'page', bucket: 'queries', day: '2026-12-31' });
    s = first.state;
    expect(charge(s, 'queries', 500, NOW + MIN, cfg).alarm).toBeNull();
    s = charge(s, 'queries', 500, NOW + MIN, cfg).state;
    const nextDay = at('2027-01-01T09:00:00Z');
    s = { queries: { ...counterOf(s, 'queries', nextDay, cfg), used: 7_999 } };
    expect(charge(s, 'queries', 1, nextDay, cfg).alarm?.day).toBe('2027-01-01');
  });
  it('names the bucket: search at 80 calls', () => {
    expect(charge(used(79, NOW, cfg, 'search'), 'search', 1, NOW, cfg).alarm?.bucket).toBe('search');
  });
});

describe('quota exceeded (AC-35 rule)', () => {
  it('stops the bucket until the next quota day', () => {
    const s = markExceeded({}, 'queries', NOW, cfg);
    expect(allow(s, 'statuses', NOW + 3 * 60 * MIN, cfg, fake)).toEqual({ ok: false, reason: 'quota-exceeded' });
    expect(allow(s, 'statuses', at('2027-01-01T07:59:59Z'), cfg, fake).ok).toBe(false);
    expect(allow(s, 'statuses', at('2027-01-01T08:00:00Z'), cfg, fake).ok).toBe(true);
  });
});

describe('ad-hoc ceiling (AC-44)', () => {
  it('ad-hoc checks stop at 500 units a day and are charged to queries too', () => {
    let s: QuotaState = {};
    let n = 0;
    for (let i = 0; i < 800; i++) {
      if (!allow(s, 'ad-hoc', NOW, cfg, fake).ok) continue;
      s = chargeCalls(s, 'ad-hoc', 1, NOW + i, cfg).state;
      n += 1;
    }
    expect(n).toBe(500);
    expect(counterOf(s, 'queries', NOW, cfg).used).toBe(500);
    expect(allow(s, 'ad-hoc', NOW, cfg, fake)).toEqual({ ok: false, reason: 'ad-hoc-ceiling' });
  });
});

describe('class ceilings of SPEC-21a (candidates, playlists)', () => {
  it.each([
    ['candidates', cfg.classCeilings.candidates],
    ['playlists', cfg.classCeilings.playlists],
  ] as const)('%s stop at their daily ceiling with class-ceiling and are charged to queries too', (cls, ceiling) => {
    let s: QuotaState = {};
    let n = 0;
    for (let i = 0; i < ceiling + 200; i++) {
      if (!allow(s, cls, NOW, cfg, fake).ok) continue;
      s = chargeCalls(s, cls, 1, NOW + i, cfg).state;
      n += 1;
    }
    expect(n).toBe(ceiling);
    expect(counterOf(s, 'queries', NOW, cfg).used).toBe(ceiling);
    expect(counterOf(s, cls, NOW, cfg).used).toBe(ceiling);
    expect(allow(s, cls, NOW, cfg, fake)).toEqual({ ok: false, reason: 'class-ceiling' });
    // Another class is untouched, and the next quota day starts afresh.
    expect(allow(s, cls === 'candidates' ? 'playlists' : 'candidates', NOW, cfg, fake).ok).toBe(true);
    expect(allow(s, cls, at('2027-01-01T08:00:00Z'), cfg, fake).ok).toBe(true);
  });
  it('the refusal order is unchanged: exceeded, exhausted and reserve come before class-ceiling', () => {
    const full = (key: 'candidates' | 'queries', n: number, over: object = {}): QuotaState => ({ [key]: { ...counterOf({}, key, NOW, cfg), used: n, ...over } });
    const both = (q: number): QuotaState => ({ ...full('candidates', cfg.classCeilings.candidates), ...full('queries', q) });
    expect(allow(both(cfg.buckets.queries.perDay - 999), 'candidates', NOW, cfg, fake)).toEqual({ ok: false, reason: 'reserve' });
    expect(allow(both(cfg.buckets.queries.perDay), 'candidates', NOW, cfg, fake)).toEqual({ ok: false, reason: 'quota-exhausted' });
    const exceeded = { ...both(0), queries: { ...counterOf({}, 'queries', NOW, cfg), exceededUntil: NOW + 1 } };
    expect(allow(exceeded, 'candidates', NOW, cfg, fake)).toEqual({ ok: false, reason: 'quota-exceeded' });
    expect(allow(both(0), 'candidates', NOW, cfg, fake)).toEqual({ ok: false, reason: 'class-ceiling' });
  });
  it('class counters raise no alarm of their own', () => {
    expect(charge({}, 'candidates', cfg.classCeilings.candidates, NOW, cfg).alarm).toBeNull();
  });
});

describe('rehearsal with the real adapter (AC-40)', () => {
  const day = at('2026-12-20T12:00:00Z');
  it('the 1 001st unit of the day is refused', () => {
    expect(allow(used(999, day), 'statuses', day, cfg, rehearsalReal).ok).toBe(true);
    expect(allow(used(1_000, day), 'statuses', day, cfg, rehearsalReal)).toEqual({ ok: false, reason: 'rehearsal-budget' });
    expect(allow(used(1_000, day), 'statuses', day, cfg, { envClass: 'rehearsal', adapter: 'fake' }).ok).toBe(true);
  });
  it('every call from 29.12 00:00 to 01.01 23:59:59 UTC is refused', () => {
    for (const iso of ['2026-12-29T00:00:00Z', '2026-12-30T12:00:00Z', '2027-01-01T23:59:59Z']) {
      expect(allow({}, 'statuses', at(iso), cfg, rehearsalReal), iso).toEqual({ ok: false, reason: 'blackout' });
    }
    expect(allow({}, 'statuses', at('2026-12-28T23:59:59Z'), cfg, rehearsalReal).ok).toBe(true);
    expect(allow({}, 'statuses', at('2027-01-02T00:00:00Z'), cfg, rehearsalReal).ok).toBe(true);
  });
});

describe('stale statuses (AC-36)', () => {
  it('page in an open window after 2 min without a fresh check, log outside, nothing while fresh', () => {
    expect(staleLevel({ inOpenWindow: true, since: NOW }, NOW + 2 * MIN, cfg)).toBeNull();
    expect(staleLevel({ inOpenWindow: true, since: NOW }, NOW + 2 * MIN + 1, cfg)).toBe('page');
    expect(staleLevel({ inOpenWindow: false, since: NOW }, NOW + 2 * MIN + 1, cfg)).toBe('log');
  });
});

describe('every quota number comes from the configuration (AC-37)', () => {
  const day = at('2026-12-20T12:00:00Z');
  const cases: Array<[string, () => boolean]> = [
    ['buckets.queries.perDay', () => allow(used(500), 'statuses', NOW, withCfg({ buckets: { ...cfg.buckets, queries: { ...cfg.buckets.queries, perDay: 500 } } }), fake).ok === false],
    ['buckets.queries.perMinute', () => allow({}, 'statuses', NOW, withCfg({ buckets: { ...cfg.buckets, queries: { ...cfg.buckets.queries, perMinute: 2 } } }), fake, 3).ok === false],
    ['buckets.queries.perUserPerMinute', () => allow({}, 'statuses', NOW, withCfg({ buckets: { ...cfg.buckets, queries: { ...cfg.buckets.queries, perUserPerMinute: 2 } } }), fake, 3).ok === false],
    ['buckets.search.perDay', () => allow(used(3, NOW, cfg, 'search'), 'search', NOW, withCfg({ buckets: { ...cfg.buckets, search: { ...cfg.buckets.search, perDay: 3 } } }), fake).ok === false],
    ['buckets.search.perMinute', () => allow({}, 'search', NOW, withCfg({ buckets: { ...cfg.buckets, search: { ...cfg.buckets.search, perMinute: 2 } } }), fake, 3).ok === false],
    ['buckets.batchGetStats.perDay', () => charge(used(0), 'batchGetStats', 8, NOW, withCfg({ buckets: { ...cfg.buckets, batchGetStats: { ...cfg.buckets.batchGetStats, perDay: 10 } } })).alarm !== null],
    ['unitsPerListCall', () => allow({}, 'statuses', NOW, withCfg({ unitsPerListCall: 3 }), fake).ok && (allow({}, 'statuses', NOW, withCfg({ unitsPerListCall: 3 }), fake) as { units: number }).units === 3],
    ['adHocCeiling', () => allow(used(10, NOW, cfg, 'ad-hoc'), 'ad-hoc', NOW, withCfg({ adHocCeiling: 10 }), fake).ok === false],
    ['reserve', () => allow(used(5_000), 'ad-hoc', NOW, withCfg({ reserve: 6_000 }), fake).ok === false],
    ['alarmRatio', () => charge(used(0), 'queries', 5_000, NOW, withCfg({ alarmRatio: 0.5 })).alarm !== null],
    ['dayTimeZone', () => quotaDay(at('2027-01-01T07:59:59Z'), 'Europe/Kyiv') === '2027-01-01'],
    ['staleMs', () => staleLevel({ inOpenWindow: true, since: NOW }, NOW + MIN + 1, withCfg({ staleMs: MIN })) === 'page'],
    ['rehearsalDailyUnits', () => allow(used(10, day), 'statuses', day, withCfg({ rehearsalDailyUnits: 10 }), rehearsalReal).ok === false],
    ['blackout', () => allow({}, 'statuses', day, withCfg({ blackout: { from: '12-20', to: '12-21' } }), rehearsalReal).ok === false],
  ];
  it.each(cases)('%s changes behaviour', (_key, changed) => {
    expect(changed()).toBe(true);
  });
  it('the defaults give the opposite outcome in each case', () => {
    expect(allow(used(500), 'statuses', NOW, cfg, fake).ok).toBe(true);
    expect(allow({}, 'statuses', NOW, cfg, fake, 3).ok).toBe(true);
    expect(allow(used(10, NOW, cfg, 'ad-hoc'), 'ad-hoc', NOW, cfg, fake).ok).toBe(true);
    expect(charge(used(0), 'queries', 5_000, NOW, cfg).alarm).toBeNull();
    expect(allow({}, 'statuses', day, cfg, rehearsalReal).ok).toBe(true);
  });

  it('no quota literal outside config.ts in src/domain/live and src/live', () => {
    const FORBIDDEN = new Set(['10000', '1800000', '600', '100', '50', '500', '1000']);
    const root = fileURLToPath(new URL('../../src/', import.meta.url));
    const files: string[] = [];
    for (const dir of ['domain/live', 'live']) {
      if (!existsSync(root + dir)) continue;
      for (const f of readdirSync(root + dir)) if (f.endsWith('.ts') && !(dir === 'domain/live' && f === 'config.ts')) files.push(`${dir}/${f}`);
    }
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const f of files) {
      const text = readFileSync(root + f, 'utf8');
      for (const m of text.matchAll(/(?<![\w.])\d[\d_]*(?![\w.])/g)) if (FORBIDDEN.has(m[0].replaceAll('_', ''))) hits.push(`${f}: ${m[0]}`);
    }
    expect(hits).toEqual([]);
  });
});
