import { describe, expect, it } from 'vitest';
import {
  advanceChain,
  classifyPlayerError,
  consentEventFor,
  selectSource,
  type ChainContext,
} from '@/lib/player/chain';
import type { PlayerSource } from '@/lib/player/types';

const NOW = Date.parse('2026-12-31T23:59:00Z');

function yt(id: string, order: number, extra: Partial<PlayerSource> = {}): PlayerSource {
  return {
    id,
    platform: 'youtube',
    videoId: `${id}`.padEnd(11, 'x').slice(0, 11),
    url: `https://www.youtube.com/watch?v=${id}`,
    order,
    status: 'live',
    embeddable: true,
    isLive: true,
    ...extra,
  };
}

function fb(id: string, order: number): PlayerSource {
  return {
    id,
    platform: 'facebook',
    url: `https://www.facebook.com/video/${id}`,
    order,
    status: 'live',
    embeddable: true,
    isLive: true,
  };
}

function ctx(sources: PlayerSource[], extra: Partial<ChainContext> = {}): ChainContext {
  return {
    slot: 'main',
    eventId: 'evt_london_2027',
    sources,
    failed: [],
    facebookConsent: false,
    now: NOW,
    ...extra,
  };
}

describe('selectSource', () => {
  it('бере перше придатне джерело за order, а не за порядком у масиві', () => {
    const sel = selectSource(ctx([yt('b', 1), yt('a', 0)]));
    expect(sel).toMatchObject({ kind: 'source', source: { id: 'a' }, index: 0 });
  });

  it('пропускає embeddable = false і живі, що перестали бути live', () => {
    const sel = selectSource(ctx([yt('a', 0, { embeddable: false }), yt('b', 1, { isLive: false }), yt('c', 2)]));
    expect(sel).toMatchObject({ kind: 'source', source: { id: 'c' } });
  });

  it('очікувана трансляція до startsAt не придатна, після — придатна', () => {
    const expected = yt('a', 0, { status: 'expected', isLive: false, startsAt: '2027-01-01T00:00:00Z' });
    expect(selectSource(ctx([expected]))).toEqual({ kind: 'countdown-scene' });
    const later = Date.parse('2027-01-01T00:00:01Z');
    expect(selectSource(ctx([expected], { now: later }))).toMatchObject({ kind: 'source', source: { id: 'a' } });
  });

  it('Facebook без згоди пропускається, якщо є інше джерело', () => {
    const sel = selectSource(ctx([fb('f', 0), yt('y', 1)]));
    expect(sel).toMatchObject({ kind: 'source', source: { id: 'y' } });
  });

  it('Facebook без згоди — лише коли немає іншого джерела → facebook-consent', () => {
    const sel = selectSource(ctx([fb('f', 0), yt('y', 1, { embeddable: false })]));
    expect(sel).toMatchObject({ kind: 'facebook-consent', source: { id: 'f' } });
    expect(consentEventFor(ctx([fb('f', 0)]), sel)).toEqual({
      eventKey: 'fb-consent:main:f',
      at: NOW,
      slot: 'main',
      eventId: 'evt_london_2027',
      sourceId: 'f',
    });
  });

  it('Facebook зі згодою — звичайне джерело в порядку ланцюжка', () => {
    const sel = selectSource(ctx([fb('f', 0), yt('y', 1)], { facebookConsent: true }));
    expect(sel).toMatchObject({ kind: 'source', source: { id: 'f' } });
  });

  it('порожній ланцюжок → countdown-scene', () => {
    expect(selectSource(ctx([]))).toEqual({ kind: 'countdown-scene' });
  });
});

describe('classifyPlayerError', () => {
  it.each([2, 5, 100, 101, 150])('%i → перемикання джерела', (code) => {
    expect(classifyPlayerError(code)).toBe('switch');
  });
  it('153 — помилка конфігурації сайту (Referrer-Policy), не вада відео', () => {
    expect(classifyPlayerError(153)).toBe('config');
  });
  it('невідомий код ігнорується', () => {
    expect(classifyPlayerError(999)).toBe('ignore');
  });
});

describe('advanceChain', () => {
  const sources = [yt('a', 0), yt('b', 1), yt('c', 2)];

  it.each([
    [101, 'not-embeddable'],
    [150, 'not-embeddable'],
    [100, 'error'],
    [5, 'error'],
    [2, 'error'],
  ] as const)('onError %i → наступне джерело, reason %s', (code, reason) => {
    const t = advanceChain(ctx(sources), { currentSourceId: 'a', cause: { type: 'error', code } });
    expect(t.type).toBe('switched');
    if (t.type !== 'switched') return;
    expect(t.selection).toMatchObject({ kind: 'source', source: { id: 'b' } });
    expect(t.failed).toEqual(['a']);
    expect(t.switched).toEqual({
      eventKey: 'switched:main:b',
      at: NOW,
      slot: 'main',
      eventId: 'evt_london_2027',
      fromSourceId: 'a',
      toSourceId: 'b',
      chainIndex: 1,
      reason,
      errorCode: code,
    });
    expect(t.consentRequired).toBeUndefined();
  });

  it('153 не перемикає джерело', () => {
    const t = advanceChain(ctx(sources), { currentSourceId: 'a', cause: { type: 'error', code: 153 } });
    expect(t).toEqual({ type: 'config-error', code: 153 });
  });

  it('завершення живого відео → наступне джерело з reason ended', () => {
    const t = advanceChain(ctx(sources), { currentSourceId: 'a', cause: { type: 'ended' } });
    expect(t.type).toBe('switched');
    if (t.type !== 'switched') return;
    expect(t.selection).toMatchObject({ kind: 'source', source: { id: 'b' } });
    expect(t.switched.reason).toBe('ended');
    expect(t.switched.errorCode).toBeUndefined();
  });

  it('уже недоступні джерела не повертаються', () => {
    const t = advanceChain(ctx(sources, { failed: ['a'] }), {
      currentSourceId: 'b',
      cause: { type: 'error', code: 100 },
    });
    if (t.type !== 'switched') throw new Error('очікувалось перемикання');
    expect(t.selection).toMatchObject({ kind: 'source', source: { id: 'c' } });
    expect(t.failed).toEqual(['a', 'b']);
  });

  it('кінець ланцюжка → countdown-scene і подія з exhausted', () => {
    const t = advanceChain(ctx(sources, { failed: ['a', 'b'] }), {
      currentSourceId: 'c',
      cause: { type: 'error', code: 150 },
    });
    if (t.type !== 'switched') throw new Error('очікувалось перемикання');
    expect(t.selection).toEqual({ kind: 'countdown-scene' });
    expect(t.switched).toMatchObject({
      fromSourceId: 'c',
      toSourceId: '',
      chainIndex: -1,
      reason: 'not-embeddable',
      errorCode: 150,
      exhausted: true,
      eventKey: 'switched:main:exhausted:c',
    });
  });

  it('після помилки лишився лише Facebook без згоди → facebook-consent і подія згоди', () => {
    const t = advanceChain(ctx([yt('y', 0), fb('f', 1)]), {
      currentSourceId: 'y',
      cause: { type: 'error', code: 101 },
    });
    if (t.type !== 'switched') throw new Error('очікувалось перемикання');
    expect(t.selection).toMatchObject({ kind: 'facebook-consent', source: { id: 'f' } });
    expect(t.switched).toMatchObject({ toSourceId: 'f', chainIndex: 1 });
    expect(t.switched.exhausted).toBeUndefined();
    expect(t.consentRequired).toMatchObject({ eventKey: 'fb-consent:main:f', sourceId: 'f' });
  });

  it('відео перестало бути live → наступне з reason not-live', () => {
    const t = advanceChain(ctx(sources, { slot: 'room:2' }), { currentSourceId: 'a', cause: { type: 'not-live' } });
    if (t.type !== 'switched') throw new Error('очікувалось перемикання');
    expect(t.switched).toMatchObject({ reason: 'not-live', slot: 'room:2', eventKey: 'switched:room:2:b' });
  });
});
