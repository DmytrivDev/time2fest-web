/**
 * Шов E5b: паспорт — штампи видає сервіс (адаптер `sim`), сторінка лише повідомляє присутність. З 2026-11-14 (стан №14):
 * опівночі +15 с клієнт показує штамп одразу й просить підтвердження (`claim`); не підтвердили — повтор у фоні.
 */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PassportEvent, PresenceClock } from '@/lib/api/contracts/passport';
import { applyPassportEvent } from '@/lib/api/contracts/passport';
import { passportStamps, resetStampClaims, usePresence, useHasStamp, useStamps, useUnconfirmedStamps } from '@/lib/api/hooks/passport';
import { resetSimFaultsForTest, simFaults } from '@/lib/api/sim/faults';
import { UNCONFIRMED_AFTER_MS } from '@/lib/passport/stampClaims';
import { wrap } from '../us1/render';
import { profileActions } from '@/lib/api/hooks/auth';
import { createSimPassport, grantStamps } from '@/lib/api/sim/passport';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { emit } from '@/lib/events/bus';
import { clearPresenceRegistry, surfacePresence } from '@/lib/presence/surfaces';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';

const london = getData().events.find((e) => e.cityId.includes('london')) ?? getData().events[0]!;
const T = london.midnightMs;

function fakeClock(start: number) {
  let t = start;
  const subs = new Set<() => void>();
  const clock: PresenceClock = { now: () => t, fallbackNow: () => t, subscribe: (cb) => (subs.add(cb), () => subs.delete(cb)) };
  return { clock, tick: (to: number) => ((t = to), subs.forEach((cb) => cb())) };
}

beforeEach(() => {
  useGuestStore.getState().resetGuest();
  clearPresenceRegistry();
  resetStampClaims();
});
afterEach(() => {
  clearPresenceRegistry();
  resetSimFaultsForTest();
  resetStampClaims();
  vi.useRealTimers();
});

describe('sim-адаптер паспорта', () => {
  it('присутність опівночі записується; штамп видає «сервер» на claim (один на подію, повтор — той самий)', async () => {
    const svc = createSimPassport();
    const events: PassportEvent[] = [];
    const offEvents = svc.subscribe((e) => events.push(e));
    const { clock, tick } = fakeClock(T - 60_000);
    const off = svc.trackPresence({ source: 'air', eventIds: [london.id], openedAt: new Map() }, clock);
    tick(T + 1_000);
    expect(useGuestStore.getState().pendingPresence[london.id]?.source).toBe('air');
    expect(surfacePresence([london.id], T + 15_000)).toEqual({ [london.id]: 'air' });
    // Сама присутність штампа не видає — лише запит клієнта.
    emit('moment:stamp', { presentEventIds: [london.id], presenceSources: { [london.id]: 'air' } } as never);
    expect(useGuestStore.getState().stamps).toEqual([]);
    const res = await svc.claim({ eventId: london.id, source: 'air', at: T + 15_000 });
    expect(res.ok && res.value.eventId).toBe(london.id);
    expect(useGuestStore.getState().stamps.map((s) => s.eventId)).toEqual([london.id]);
    expect(events).toEqual([{ type: 'granted', stamp: useGuestStore.getState().stamps[0] }]);
    await svc.claim({ eventId: london.id, source: 'air', at: T + 15_000 });
    expect(useGuestStore.getState().stamps).toHaveLength(1);
    off();
    offEvents();
  });

  it('grantStamps: один штамп на подію; скидання гостя — подія snapshot', () => {
    const svc = createSimPassport();
    const events: PassportEvent['type'][] = [];
    const off = svc.subscribe((e) => events.push(e.type));
    expect(grantStamps({ presentEventIds: [london.id], presenceSources: {} } as never)).toEqual([london.id]);
    expect(grantStamps({ presentEventIds: [london.id], presenceSources: {} } as never)).toEqual([]);
    useGuestStore.getState().resetGuest();
    off();
    expect(events).toEqual(['granted', 'snapshot']);
    expect(svc.mergeGuest).toBeUndefined();
  });
});

describe('хуки паспорта', () => {
  it('сторінка присутності відкрита: опівночі +15 с штамп одразу; без сторінки — штампа немає', () => {
    emit('moment:stamp', { presentEventIds: [london.id], presenceSources: {} } as never);
    expect(useGuestStore.getState().stamps).toEqual([]);
    const { result, unmount } = renderHook(() => (usePresence({ source: 'air', eventIds: [london.id] }), useStamps()), {
      wrapper: ({ children }) => wrap(<>{children}</>, T + 15_000),
    });
    act(() => emit('moment:stamp', { presentEventIds: [london.id], presenceSources: { [london.id]: 'air' } } as never));
    expect(result.current.map((s) => s.eventId)).toEqual([london.id]);
    expect(useGuestStore.getState().stamps.map((s) => s.eventId)).toEqual([london.id]);
    unmount();
  });

  it('сервер не підтвердив (стан №14): штамп видно одразу, за хвилину — «непідтверджений», повтор у фоні додає його в паспорт', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T + 15_000);
    simFaults.fail('passport', 'claim', 'network');
    const { result, unmount } = renderHook(
      () => ({ stamps: (usePresence({ source: 'air', eventIds: [london.id] }), useStamps()), unconfirmed: useUnconfirmedStamps() }),
      { wrapper: ({ children }) => wrap(<>{children}</>, T + 15_000) },
    );
    act(() => emit('moment:stamp', { presentEventIds: [london.id], presenceSources: { [london.id]: 'air' } } as never));
    expect(result.current.stamps.map((s) => s.eventId)).toEqual([london.id]);
    expect(useGuestStore.getState().stamps).toEqual([]);
    expect(result.current.unconfirmed).toEqual([]);
    await act(() => vi.advanceTimersByTimeAsync(UNCONFIRMED_AFTER_MS));
    expect(result.current.unconfirmed).toEqual([london.id]);
    expect(result.current.stamps.map((s) => s.eventId)).toEqual([london.id]);
    simFaults.unfail('passport', 'claim');
    await act(() => vi.advanceTimersByTimeAsync(30_000));
    expect(useGuestStore.getState().stamps.map((s) => s.eventId)).toEqual([london.id]);
    expect(result.current.unconfirmed).toEqual([]);
    unmount();
  });

  it('useStamps: peek — дані в першому ж рендері; нові штампи приходять подією', () => {
    grantStamps({ presentEventIds: [london.id], presenceSources: {} } as never);
    passportStamps.reset();
    const { result } = renderHook(() => ({ all: useStamps(), has: useHasStamp(london.id) }));
    expect(result.current.all).toHaveLength(1);
    expect(result.current.has).toBe(true);
    act(() => useGuestStore.getState().resetGuest());
    expect(result.current.all).toEqual([]);
  });

  it('applyPassportEvent: без дублів; snapshot замінює', () => {
    const s = { eventId: 'e1' } as Stamp;
    expect(applyPassportEvent([s], { type: 'granted', stamp: s })).toEqual([s]);
    expect(applyPassportEvent([s], { type: 'snapshot', stamps: [] })).toEqual([]);
  });

  it('графік — через профіль: toggle/replace/set тим самим правилом, синхронно в sim', async () => {
    expect((await profileActions.toggleSchedule(london.id)).ok).toBe(false); // без паса — `forbidden` (SPEC-11)
    useAuthStore.setState({ devicePass: { id: 'p', email: 'a@b.co', since: 0 } });
    await profileActions.toggleSchedule(london.id);
    expect(useGuestStore.getState().schedule).toContain(london.id);
    await profileActions.setSchedule([]);
    expect(useGuestStore.getState().schedule).toEqual([]);
  });
});
