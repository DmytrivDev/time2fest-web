/**
 * AC-54: штамп (час видачі) іде за виправленим моментом події — і «сервер» sim (`grantStamp`, `grantStamps`), і штамп
 * на пристрої (`claimFromMoment` через `moment:stamp`). Без поправки — як раніше.
 *
 * Модулі підвантажуються після `vi.resetModules()`: файл налаштування вже імпортував `hooks/passport` з реальним
 * `hooks/site`, тож підміна `patchedData` без скидання не діяла б.
 */
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EventPatches } from '@/lib/data/patched';
import type { Stamp } from '@/lib/data/types';

const patches: { current: EventPatches | undefined } = { current: undefined };

async function load() {
  vi.resetModules();
  vi.doMock('@/lib/api/hooks/site', async (importOriginal) => {
    const orig = await importOriginal<typeof import('@/lib/api/hooks/site')>();
    const { getData } = await import('@/lib/data/load');
    const { withEventPatches } = await import('@/lib/data/patched');
    return { ...orig, patchedData: () => withEventPatches(getData(), patches.current) };
  });
  const [{ getData }, hooks, sim, bus, presence, guest, render] = await Promise.all([
    import('@/lib/data/load'),
    import('@/lib/api/hooks/passport'),
    import('@/lib/api/sim/passport'),
    import('@/lib/events/bus'),
    import('@/lib/presence/surfaces'),
    import('@/stores/guest'),
    import('../us1/render'),
  ]);
  return { getData, hooks, sim, bus, presence, guest, wrap: render.wrap };
}

const SHIFT = 20 * 60_000;
let m: Awaited<ReturnType<typeof load>>;

beforeEach(async () => {
  patches.current = undefined;
  m = await load();
  m.guest.useGuestStore.getState().resetGuest();
  m.presence.clearPresenceRegistry();
  m.hooks.resetStampClaims();
});
afterEach(() => {
  m.presence.clearPresenceRegistry();
  m.hooks.resetStampClaims();
  vi.doUnmock('@/lib/api/hooks/site');
});

describe('штамп і виправлений момент', () => {
  const eventOf = () => m.getData().events.find((e) => e.cityId.includes('london')) ?? m.getData().events[0]!;
  const payloadOf = (id: string) => ({ presentEventIds: [id], presenceSources: {} }) as never;

  it('sim-«сервер» без поправки: grantedAt за каталогом', () => {
    const event = eventOf();
    expect(m.sim.grantStamp(event.id, 'air')?.grantedAt).toBe(event.midnightMs + 15_000);
  });

  it('sim-«сервер» з поправкою −20 хв: grantedAt за новим моментом', () => {
    const event = eventOf();
    patches.current = { [event.id]: { moment: event.midnightMs - SHIFT } };
    expect(m.sim.grantStamps(payloadOf(event.id))).toEqual([event.id]);
    expect(m.guest.useGuestStore.getState().stamps.at(-1)?.grantedAt).toBe(event.midnightMs - SHIFT + 15_000);
  });

  it('штамп на пристрої з moment:stamp іде за виправленим моментом', () => {
    const event = eventOf();
    patches.current = { [event.id]: { moment: event.midnightMs - SHIFT } };
    const got: Stamp[] = [];
    const off = m.hooks.onStampGranted((s) => got.push(s));
    const { unmount } = renderHook(() => m.hooks.usePresence(null), {
      wrapper: ({ children }) => m.wrap(<>{children}</>, event.midnightMs + 15_000),
    });
    m.bus.emit('moment:stamp', payloadOf(event.id));
    expect(got.map((s) => s.grantedAt)).toEqual([event.midnightMs - SHIFT + 15_000]);
    unmount();
    off();
  });
});
