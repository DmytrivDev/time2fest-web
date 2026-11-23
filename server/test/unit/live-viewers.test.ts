/** Viewers aggregate (SPEC-12 AC-60, AC-61, AC-62, NFR-6), without Centrifugo. */
import { describe, expect, it } from 'vitest';
import { LIVE_DEFAULTS } from '../../src/domain/live/config';
import { aggregateViewers, viewerCatalogOrder, type PresenceEntry, type ViewerCatalogCountry } from '../../src/domain/live/viewers';
import { issueViewerToken, VIEWER_TOKEN_TTL_SECONDS } from '../../src/live/viewers';

const AT = '2026-12-31T23:00:00.000Z';
const on = { viewersMap: true, viewersCount: true };
const catalog: ViewerCatalogCountry[] = viewerCatalogOrder([
  { iso: 'DE', name: 'Німеччина', flagCode: 'DE', popularity: 80 },
  { iso: 'PL', name: 'Польща', flagCode: 'PL', popularity: 60 },
  { iso: 'UA', name: 'Україна', flagCode: 'UA', popularity: 95 },
]);
let seq = 0;
/** A counted entry with its own token nonce (each viewer token carries a fresh one). */
const person = (c?: string, n = `n-${++seq}`): PresenceEntry => ({ chanInfo: c === undefined ? { p: 1, n } : { p: 1, n, c } });
const tab: PresenceEntry = { chanInfo: undefined };

describe('countries with at least 3 people, no numbers (AC-60)', () => {
  it('3 from PL, 2 from DE → only PL', () => {
    const entries = [person('PL'), person('PL'), person('PL'), person('DE'), person('DE')];
    expect(aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS)).toEqual({
      countries: [{ iso: 'PL', name: 'Польща', flagCode: 'PL' }],
      people: 5,
      at: AT,
    });
  });
  it('orders by catalog popularity and drops XX, T1, malformed and unknown codes', () => {
    const entries = [...['PL', 'UA', 'XX', 'T1', 'pl', 'ZZ'].flatMap((c) => [person(c), person(c), person(c)])];
    const r = aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS);
    expect(r.countries.map((c) => c.iso)).toEqual(['UA', 'PL']);
    expect(r.people).toBe(18);
  });
  it('the threshold comes from the configuration', () => {
    const r = aggregateViewers([person('DE'), person('DE')], on, catalog, AT, { ...LIVE_DEFAULTS, viewersMinPerCountry: 2 });
    expect(r.countries.map((c) => c.iso)).toEqual(['DE']);
  });
});

describe('people: one per browser (AC-61)', () => {
  it('counts token entries only; a second tab without a token is not a person', () => {
    const r = aggregateViewers([person('UA'), person(), person('PL'), tab, { chanInfo: { p: 2 } }, { chanInfo: 'x' }], on, catalog, AT, LIVE_DEFAULTS);
    expect(r.people).toBe(3);
  });
});

describe('one token reused on many connections is one person (security S12-01)', () => {
  it('two entries with the same nonce count once, for people and for the country', () => {
    const r = aggregateViewers([person('PL', 'same'), person('PL', 'same'), person('PL'), person('PL')], on, catalog, AT, LIVE_DEFAULTS);
    expect(r.people).toBe(3);
    const twice = aggregateViewers([person('PL', 'a'), person('PL', 'a'), person('PL', 'a'), person('PL', 'b')], on, catalog, AT, LIVE_DEFAULTS);
    expect(twice.people).toBe(2);
    expect(twice.countries).toEqual([]);
  });
  it('an entry without a nonce, or with an empty or oversized one, is not counted', () => {
    const r = aggregateViewers([{ chanInfo: { p: 1, c: 'PL' } }, person('PL', ''), person('PL', 'x'.repeat(65)), person('PL')], on, catalog, AT, LIVE_DEFAULTS);
    expect(r.people).toBe(1);
  });
});

describe('viewer token (S12-01)', () => {
  const issue = async (country: string) => {
    const calls: { info: Record<string, unknown>; iat: number; exp: number }[] = [];
    const signer = { signSubscription: async (a: { channel: string; info: Record<string, unknown>; iat: number; exp: number }) => (calls.push(a), 'tok') };
    const r = await issueViewerToken({ signer, channel: 'live:viewers', clock: { now: () => Date.parse(AT) } }, country);
    expect(r.ok).toBe(true);
    return calls[0]!;
  };
  it('carries a fresh random nonce per token and lives 10 minutes', async () => {
    const a = await issue('PL');
    const b = await issue('XX');
    expect(a.info).toEqual({ p: 1, n: expect.stringMatching(/^[0-9a-f-]{36}$/), c: 'PL' });
    expect(b.info).toEqual({ p: 1, n: expect.any(String) });
    expect(a.info.n).not.toBe(b.info.n);
    expect(a.exp - a.iat).toBe(VIEWER_TOKEN_TTL_SECONDS);
    expect(VIEWER_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(600);
  });
});

describe('switches (AC-62)', () => {
  const entries = [person('PL'), person('PL'), person('PL')];
  it.each([
    [{ viewersMap: true, viewersCount: true }, ['PL'], 3],
    [{ viewersMap: false, viewersCount: true }, [], 3],
    [{ viewersMap: true, viewersCount: false }, ['PL'], undefined],
    [{ viewersMap: false, viewersCount: false }, [], undefined],
  ])('%o', (switches, isos, people) => {
    const r = aggregateViewers(entries, switches, catalog, AT, LIVE_DEFAULTS);
    expect(r.countries.map((c) => c.iso)).toEqual(isos);
    expect(r.people).toBe(people);
    expect('people' in r).toBe(people !== undefined);
  });
});

describe('30 000 connections (NFR-6)', () => {
  it('aggregates in under 100 ms', () => {
    const isos = ['UA', 'PL', 'DE', 'XX', undefined];
    const entries: PresenceEntry[] = Array.from({ length: 30_000 }, (_, i) => (i % 7 === 0 ? tab : person(isos[i % isos.length])));
    aggregateViewers(entries.slice(0, 100), on, catalog, AT, LIVE_DEFAULTS);
    const t = performance.now();
    const r = aggregateViewers(entries, on, catalog, AT, LIVE_DEFAULTS);
    const ms = performance.now() - t;
    expect(r.countries.map((c) => c.iso)).toEqual(['UA', 'DE', 'PL']);
    expect(ms).toBeLessThan(100);
  });
});
