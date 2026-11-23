/**
 * Шов: хуки ефіру над підміненим сервісом. Перевіряємо: стартове значення зі збірки (без блимання), поправки сервера
 * (realtime-подія), відповідь без змін не будить споживачів, `useLiveData` і `getStreamChains`, версії (AC-17),
 * `hide` (AC-18), відмова читання (AC-20), глядачі й `usePeopleNow` (AC-64).
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChainsResponse, LiveService, StreamEvent, ViewerSummary } from '@/lib/api/contracts/live';
import type { SiteService, SiteState } from '@/lib/api/contracts/site';
import { getStreamChains, streamChains, useLiveData, usePeopleNow, useStreamChain, useStreamChains, useViewers } from '@/lib/api/hooks/live';
import { fail, ok, type ApiResult } from '@/lib/api/result';
import { setServicesForTest } from '@/lib/api/services';
import { buildSnapshot } from '@/lib/api/site/buildSnapshot';
import { getData } from '@/lib/data/load';
import { computeBroadcast } from '@/lib/player/BroadcastController';
import type { StreamChain } from '@/lib/data/types';

const data = getData();
const [eventId, chain] = [...data.chainsByEventId.entries()].find(([, c]) => c.sources.length > 1)!;
const first = chain.sources[0]!;

const response = (version: number, chains: readonly StreamChain[] = [...data.chainsByEventId.values()]): ChainsResponse => ({
  version,
  at: '2026-12-31T20:00:00Z',
  chains: [...chains],
});

function fakeService(serverChains: () => ChainsResponse, summary: ViewerSummary) {
  const stream = new Set<(e: StreamEvent) => void>();
  const viewerCbs = new Set<(s: ViewerSummary) => void>();
  const svc: LiveService = {
    chains: vi.fn(async (): Promise<ApiResult<ChainsResponse>> => ok(serverChains())),
    subscribeStreams: vi.fn((cb) => {
      stream.add(cb);
      return () => stream.delete(cb);
    }),
    viewers: vi.fn(async () => ok(summary)),
    subscribeViewers: vi.fn((cb) => {
      viewerCbs.add(cb);
      return () => viewerCbs.delete(cb);
    }),
    reportSourceError: vi.fn(async () => ok(undefined)),
  };
  const send = (e: StreamEvent) => act(() => stream.forEach((l) => l(e)));
  return { svc, stream, viewerCbs, send };
}

const SUMMARY: ViewerSummary = { countries: [{ iso: 'UA', name: 'Україна', flagCode: 'ua' }], at: '2026-12-31T20:00:00Z' };
let restore: () => void = () => undefined;
afterEach(() => restore());

describe('ланцюжки', () => {
  let fake: ReturnType<typeof fakeService>;
  beforeEach(() => {
    fake = fakeService(() => response(1), SUMMARY);
    restore = setServicesForTest({ live: fake.svc });
  });

  it('стартове значення — зі збірки одразу (без блимання); відповідь без змін лишає ту саму мапу', async () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useStreamChains();
    });
    expect(result.current).toBe(data.chainsByEventId);
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(result.current).toBe(data.chainsByEventId);
    expect(renders).toBeLessThanOrEqual(3); // idle → loading → ready: лише зміни стану, мапа та сама
    expect(getStreamChains()).toBe(data.chainsByEventId);
  });

  it('realtime: поправка джерела доходить до useStreamChain і getStreamChains; відписка після відмонтування', async () => {
    const { result, unmount } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.subscribeStreams).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    expect(result.current).toBe(chain);
    fake.send({ type: 'source', eventId, source: { ...first, embeddable: !first.embeddable }, version: 2 });
    expect(result.current!.sources[0]!.embeddable).toBe(!first.embeddable);
    expect(getStreamChains().get(eventId)!.sources[0]!.embeddable).toBe(!first.embeddable);
    unmount();
    expect(fake.stream.size).toBe(0);
  });

  it('useLiveData: каталог з поточними ланцюжками; без змін — той самий об’єкт, що getData()', async () => {
    const { result } = renderHook(() => useLiveData());
    expect(result.current).toBe(data);
    await waitFor(() => expect(fake.svc.subscribeStreams).toHaveBeenCalled());
    await act(async () => undefined);
    fake.send({ type: 'source', eventId, source: { ...first, isLive: !first.isLive }, version: 2 });
    expect(result.current).not.toBe(data);
    expect(result.current.chainsByEventId.get(eventId)!.sources[0]!.isLive).toBe(!first.isLive);
    expect(result.current.zones).toBe(data.zones);
  });

  it('AC-18: hide прибирає джерело з ланцюжка', async () => {
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalled());
    await act(async () => undefined);
    fake.send({ type: 'hide', eventId, sourceId: first.id, version: 2 });
    expect(result.current!.sources.some((s) => s.id === first.id)).toBe(false);
  });

  it('AC-17: подія старішої версії відкидається', async () => {
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalled());
    await act(async () => undefined);
    fake.send({ type: 'hide', eventId, sourceId: first.id, version: 5 });
    const afterHide = result.current;
    fake.send({ type: 'chain', chain, version: 4 });
    expect(result.current).toBe(afterHide);
    expect(result.current!.sources.some((s) => s.id === first.id)).toBe(false);
  });

  it('AC-17: відповідь старішої версії за застосовану відкидається', async () => {
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    fake.send({ type: 'hide', eventId, sourceId: first.id, version: 7 });
    (fake.svc.chains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(ok(response(6)));
    await act(() => streamChains.refresh());
    expect(result.current!.sources.some((s) => s.id === first.id)).toBe(false);
  });

  it('AC-17: подія під час завантаження накладається на відповідь після нього', async () => {
    let answer!: (r: ApiResult<ChainsResponse>) => void;
    (fake.svc.chains as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<ApiResult<ChainsResponse>>((resolve) => (answer = resolve)),
    );
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalledTimes(1));
    fake.send({ type: 'hide', eventId, sourceId: first.id, version: 3 });
    await act(async () => answer(ok(response(2))));
    expect(result.current!.sources.some((s) => s.id === first.id)).toBe(false);
    expect(result.current!.sources).toHaveLength(chain.sources.length - 1);
  });

  it('AC-20: відмова без попереднього стану — ланцюжок зі збірки', async () => {
    (fake.svc.chains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail('network'));
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toBe(chain);
  });

  it('AC-20: відмова з попереднім станом — лишається останнє застосоване', async () => {
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalledTimes(1));
    await act(async () => undefined);
    fake.send({ type: 'hide', eventId, sourceId: first.id, version: 2 });
    const kept = result.current;
    (fake.svc.chains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail('network'));
    await act(() => streamChains.refresh());
    expect(result.current).toBe(kept);
  });
});

describe('глядачі', () => {
  it('порожньо до завантаження, далі країни з сервісу; realtime-агрегат замінює', async () => {
    const fake = fakeService(() => response(1, []), SUMMARY);
    restore = setServicesForTest({ live: fake.svc });
    const { result } = renderHook(() => useViewers());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(SUMMARY.countries));
    act(() => fake.viewerCbs.forEach((l) => l({ ...SUMMARY, countries: [] })));
    expect(result.current).toEqual([]);
  });
});

describe('usePeopleNow (AC-64)', () => {
  function siteWith(viewersCount: boolean): SiteService {
    const base = buildSnapshot(data.meta);
    const state: SiteState = { ...base, switches: { ...base.switches, viewersCount } };
    return { state: async () => ok(state), subscribe: () => () => undefined, peek: () => state };
  }

  async function peopleNow(people: number | undefined, viewersCount: boolean) {
    const fake = fakeService(() => response(1), { ...SUMMARY, ...(people === undefined ? {} : { people }) });
    restore = setServicesForTest({ live: fake.svc, site: siteWith(viewersCount) });
    const { result } = renderHook(() => usePeopleNow());
    await waitFor(() => expect(fake.svc.viewers).toHaveBeenCalled());
    await act(async () => undefined);
    return result.current;
  }

  it('people > 0 і вимикач увімкнено — число', async () => {
    expect(await peopleNow(12_480, true)).toBe(12_480);
  });

  it('вимикач вимкнено — немає', async () => {
    expect(await peopleNow(12_480, false)).toBeUndefined();
  });

  it('people = 0 — немає', async () => {
    expect(await peopleNow(0, true)).toBeUndefined();
  });

  it('people відсутнє в агрегаті — немає', async () => {
    expect(await peopleNow(undefined, true)).toBeUndefined();
  });
});

describe('чисті споживачі ланцюжків отримують їх аргументом', () => {
  it('computeBroadcast: ланцюжок ефіру береться з переданої мапи (а за замовчуванням — з кешу шва)', () => {
    const london = data.events.find((e) => e.cityId === 'london')!;
    const at = london.midnightMs + 60_000;
    const fromBuild = computeBroadcast(at, null);
    expect(fromBuild.chain?.sources.length).toBeGreaterThan(0);
    const emptied = computeBroadcast(at, null, new Map());
    expect(emptied.chain?.sources ?? []).toEqual([]);
  });
});
