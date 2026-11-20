/**
 * Поправка моменту посеред сеансу (знімок `site`, AC-53/54): `EngineScheduler` не перестворюється, тож новий екземпляр
 * не відновлює «пропущене» (`late: true`) і нічого не емітує двічі.
 */
import { act, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import { withEventPatches } from '@/lib/data/patched';
import { clearAllHandlers, on } from '@/lib/events/bus';
import { EngineScheduler } from '@/lib/events/EngineSchedulerMount';
import type { MomentStamp } from '@/lib/events/types';
import { MIN, miniSchedule, PARIS_MIDNIGHT, SEC } from '../fixtures/data';

const clockState = vi.hoisted(() => {
  const state = {
    now: 0,
    subs: new Set<() => void>(),
    clock: null as unknown as { getSnapshot(): number; subscribe(cb: () => void): () => void },
  };
  // Один екземпляр, як у `TimeProvider`: інакше кожен рендер мав би «новий» годинник і перестворював ефект.
  state.clock = {
    getSnapshot: () => state.now,
    subscribe: (cb) => (state.subs.add(cb), () => state.subs.delete(cb)),
  };
  return state;
});
vi.mock('@/lib/time/TimeProvider', () => ({ useClock: () => clockState.clock }));

const { schedule, countries, streams } = miniSchedule();
const data = buildDataset(schedule, countries, streams);
const moved = PARIS_MIDNIGHT - 20 * MIN;

const tickTo = (to: number) => {
  for (let t = clockState.now; t <= to; t += SEC) {
    clockState.now = t;
    act(() => clockState.subs.forEach((cb) => cb()));
  }
};

afterEach(() => {
  clearAllHandlers();
  clockState.subs.clear();
});

describe('EngineScheduler: поправка моменту під час сеансу', () => {
  it('пересунутий момент емітується раз, не пізно; решта — без повторів', () => {
    const stamps: MomentStamp[] = [];
    on('moment:stamp', (p) => stamps.push(p));

    clockState.now = moved - 10 * SEC;
    const view = render(<EngineScheduler data={data} />);
    tickTo(moved + 14 * SEC);
    expect(stamps).toHaveLength(0); // за каталогом Париж лише о 23:00

    // знімок із поправкою −20 хв приходить між тактами, а наступний такт якраз перетинає штамп нового моменту
    clockState.now = moved + 15 * SEC;
    const patched = withEventPatches(data, { evt_paris_2027: { moment: moved } });
    view.rerender(<EngineScheduler data={patched} />);
    tickTo(moved + 30 * SEC);

    const first = stamps.filter((s) => s.at === moved + 15 * SEC);
    expect(first).toHaveLength(1);
    expect(first[0]!.late).toBeUndefined();

    // дальше — звичайні такти: ні повторів, ні пізніх
    tickTo(PARIS_MIDNIGHT + 20 * SEC);
    expect(new Set(stamps.map((s) => s.eventKey)).size).toBe(stamps.length);
    expect(stamps.filter((s) => s.at === moved + 15 * SEC)).toHaveLength(1);
    expect(stamps.some((s) => s.late)).toBe(false);
  });
});
