/** Шов: хук `useSiteState` — подія під час завантаження не губиться, старіша не перемагає. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import type { SiteEvent, SiteService, SiteState } from '@/lib/api/contracts/site';
import { useSiteState } from '@/lib/api/hooks/site';
import { ok } from '@/lib/api/result';
import { setServicesForTest } from '@/lib/api/services';

const make = (version: number): SiteState => ({
  version,
  at: new Date(0).toISOString(),
  switches: {
    chat: true,
    toasts: true,
    pass: true,
    passGift: true,
    payments: true,
    viewersMap: true,
    passOffer: true,
    chatRooms: {},
    toastTiers: { '2': true, '5': true, '10': true },
  },
  products: [],
  catalogVersion: 'a+b',
  eventPatches: {},
});

function fake() {
  let resolve!: (s: SiteState) => void;
  const pending = new Promise<SiteState>((r) => (resolve = r));
  let cb: ((e: SiteEvent) => void) | undefined;
  const svc: SiteService = {
    state: () => pending.then((s) => ok(s)),
    subscribe: (c) => {
      cb = c;
      return () => {
        cb = undefined;
      };
    },
    peek: () => undefined,
  };
  return { svc, resolve, emit: (s: SiteState) => cb?.({ type: 'snapshot', state: s }) };
}

let restore: (() => void) | undefined;
afterEach(() => restore?.());

describe('useSiteState', () => {
  it('подія v5 під час завантаження перемагає відповідь v3', async () => {
    const f = fake();
    restore = setServicesForTest({ site: f.svc });
    const { result } = renderHook(() => useSiteState());
    await waitFor(() => expect(result.current.status).toBe('loading'));
    act(() => f.emit(make(5)));
    await act(async () => f.resolve(make(3)));
    await waitFor(() => expect(result.current.state?.version).toBe(5));
  });

  it('подія v2 під час завантаження програє відповіді v3', async () => {
    const f = fake();
    restore = setServicesForTest({ site: f.svc });
    const { result } = renderHook(() => useSiteState());
    await waitFor(() => expect(result.current.status).toBe('loading'));
    act(() => f.emit(make(2)));
    await act(async () => f.resolve(make(3)));
    await waitFor(() => expect(result.current.state?.version).toBe(3));
  });
});
