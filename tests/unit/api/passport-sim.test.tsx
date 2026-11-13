/** Шов E5b: паспорт — штампи видає сервіс (адаптер `sim`), сторінка лише повідомляє присутність. */
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { PassportEvent, PresenceClock } from '@/lib/api/contracts/passport';
import { applyPassportEvent } from '@/lib/api/contracts/passport';
import { passportStamps, useHasStamp, useStamps } from '@/lib/api/hooks/passport';
import { profileActions } from '@/lib/api/hooks/auth';
import { createSimPassport, grantStamps } from '@/lib/api/sim/passport';
import { getData } from '@/lib/data/load';
import type { Stamp } from '@/lib/data/types';
import { emit } from '@/lib/events/bus';
import { clearPresenceRegistry, surfacePresence } from '@/lib/presence/surfaces';
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
});
afterEach(() => clearPresenceRegistry());

describe('sim-адаптер паспорта', () => {
  it('присутність опівночі записується; штамп видає «сервер» на moment:stamp, поки сторінка відкрита', () => {
    const svc = createSimPassport();
    const events: PassportEvent[] = [];
    const offEvents = svc.subscribe((e) => events.push(e));
    const { clock, tick } = fakeClock(T - 60_000);
    const off = svc.trackPresence({ source: 'air', eventIds: [london.id], openedAt: new Map() }, clock);
    tick(T + 1_000);
    expect(useGuestStore.getState().pendingPresence[london.id]?.source).toBe('air');
    expect(surfacePresence([london.id], T + 15_000)).toEqual({ [london.id]: 'air' });
    emit('moment:stamp', { presentEventIds: [london.id], presenceSources: { [london.id]: 'air' } } as never);
    expect(useGuestStore.getState().stamps.map((s) => s.eventId)).toEqual([london.id]);
    expect(events).toEqual([{ type: 'granted', stamp: useGuestStore.getState().stamps[0] }]);
    off();
    offEvents();
  });

  it('жодна сторінка присутності не відкрита — штампів немає (як раніше: слухали лише сторінки ефіру/країни/кімнати/ТВ)', () => {
    emit('moment:stamp', { presentEventIds: [london.id], presenceSources: {} } as never);
    expect(useGuestStore.getState().stamps).toEqual([]);
    const off = createSimPassport().trackPresence(null, fakeClock(T).clock);
    emit('moment:stamp', { presentEventIds: [london.id], presenceSources: {} } as never);
    expect(useGuestStore.getState().stamps).toHaveLength(1);
    off();
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
    await profileActions.toggleSchedule(london.id);
    expect(useGuestStore.getState().schedule).toContain(london.id);
    await profileActions.setSchedule([]);
    expect(useGuestStore.getState().schedule).toEqual([]);
  });
});
