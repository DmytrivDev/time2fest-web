/**
 * Шов: хуки ефіру над підміненим сервісом. Перевіряємо: стартове значення зі збірки (без блимання), поправки сервера
 * (realtime-подія), відповідь без змін не будить споживачів, `useLiveData` і `getStreamChains`, глядачі.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveService, StreamEvent, ViewerSummary } from '@/lib/api/contracts/live';
import { getStreamChains, useLiveData, useStreamChain, useStreamChains, useViewers } from '@/lib/api/hooks/live';
import { fail, ok } from '@/lib/api/result';
import { setServicesForTest } from '@/lib/api/services';
import { getData } from '@/lib/data/load';
import { computeBroadcast } from '@/lib/player/BroadcastController';
import type { StreamChain } from '@/lib/data/types';

const data = getData();
const [eventId, chain] = [...data.chainsByEventId.entries()].find(([, c]) => c.sources.length > 1)!;

function fakeService(serverChains: () => readonly StreamChain[], summary: ViewerSummary) {
  const stream = new Set<(e: StreamEvent) => void>();
  const viewerCbs = new Set<(s: ViewerSummary) => void>();
  const svc: LiveService = {
    chains: vi.fn(async () => ok(serverChains())),
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
  return { svc, stream, viewerCbs };
}

const SUMMARY: ViewerSummary = { countries: [{ iso: 'UA', name: 'Україна', flagCode: 'ua' }], at: '2026-12-31T20:00:00Z' };
let restore: () => void = () => undefined;
afterEach(() => restore());

describe('ланцюжки', () => {
  let fake: ReturnType<typeof fakeService>;
  beforeEach(() => {
    fake = fakeService(() => [...data.chainsByEventId.values()], SUMMARY);
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
    expect(result.current).toBe(chain);
    const first = chain.sources[0]!;
    act(() => fake.stream.forEach((l) => l({ type: 'source', eventId, source: { ...first, embeddable: !first.embeddable } })));
    expect(result.current!.sources[0]!.embeddable).toBe(!first.embeddable);
    expect(getStreamChains().get(eventId)!.sources[0]!.embeddable).toBe(!first.embeddable);
    unmount();
    expect(fake.stream.size).toBe(0);
  });

  it('useLiveData: каталог з поточними ланцюжками; без змін — той самий об’єкт, що getData()', async () => {
    const { result } = renderHook(() => useLiveData());
    expect(result.current).toBe(data);
    await waitFor(() => expect(fake.svc.subscribeStreams).toHaveBeenCalled());
    const first = chain.sources[0]!;
    act(() => fake.stream.forEach((l) => l({ type: 'source', eventId, source: { ...first, isLive: !first.isLive } })));
    expect(result.current).not.toBe(data);
    expect(result.current.chainsByEventId.get(eventId)!.sources[0]!.isLive).toBe(!first.isLive);
    expect(result.current.zones).toBe(data.zones);
  });

  it('відмова сервісу не ламає: лишається ланцюжок зі збірки', async () => {
    (fake.svc.chains as ReturnType<typeof vi.fn>).mockResolvedValueOnce(fail('network'));
    const { result } = renderHook(() => useStreamChain(eventId));
    await waitFor(() => expect(fake.svc.chains).toHaveBeenCalled());
    await act(async () => undefined);
    expect(result.current).toBe(chain);
  });
});

describe('глядачі', () => {
  it('порожньо до завантаження, далі країни з сервісу; realtime-агрегат замінює', async () => {
    const fake = fakeService(() => [], SUMMARY);
    restore = setServicesForTest({ live: fake.svc });
    const { result } = renderHook(() => useViewers());
    expect(result.current).toEqual([]);
    await waitFor(() => expect(result.current).toEqual(SUMMARY.countries));
    act(() => fake.viewerCbs.forEach((l) => l({ ...SUMMARY, countries: [] })));
    expect(result.current).toEqual([]);
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
