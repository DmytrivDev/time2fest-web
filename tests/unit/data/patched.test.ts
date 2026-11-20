import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import { withEventPatches } from '@/lib/data/patched';
import { LONDON_MIDNIGHT, MIN, miniSchedule, PARIS_MIDNIGHT } from '../fixtures/data';

const { schedule, countries, streams } = miniSchedule();
const data = buildDataset(schedule, countries, streams);

describe('withEventPatches: без поправки моменту — ті самі дані', () => {
  it('немає поправок, порожні поправки, поправки без moment — той самий об’єкт', () => {
    expect(withEventPatches(data, undefined)).toBe(data);
    expect(withEventPatches(data, {})).toBe(data);
    expect(withEventPatches(data, { evt_paris_2027: { isMainCelebration: false } as { moment?: number } })).toBe(data);
  });

  it('поправка невідомої події чи на той самий момент — той самий об’єкт', () => {
    expect(withEventPatches(data, { evt_nowhere_2027: { moment: PARIS_MIDNIGHT } })).toBe(data);
    expect(withEventPatches(data, { evt_paris_2027: { moment: PARIS_MIDNIGHT } })).toBe(data);
  });
});

describe('withEventPatches: поправка −20 хв', () => {
  const moved = PARIS_MIDNIGHT - 20 * MIN;
  const patches = { evt_paris_2027: { moment: moved } };
  const patched = withEventPatches(data, patches);

  it('подія отримує новий момент і ISO у форматі розкладу', () => {
    const e = patched.eventsById.get('evt_paris_2027')!;
    expect(e.midnightMs).toBe(moved);
    expect(e.midnightUtc).toBe('2026-12-31T22:40:00Z');
    expect(patched.events.find((x) => x.id === 'evt_paris_2027')).toBe(e);
  });

  it('подія переходить у власний слот, старий слот лишається з рештою подій', () => {
    const slots = patched.eventsBySlot.map((s) => [s.midnightMs, s.events.map((e) => e.id)]);
    expect(slots[0]).toEqual([moved, ['evt_paris_2027']]);
    expect(slots[1]).toEqual([PARIS_MIDNIGHT, ['evt_berlin_2027']]);
    expect(patched.eventsBySlot[0]!.midnightUtc).toBe('2026-12-31T22:40:00Z');
    expect(patched.eventsBySlot[2]!.midnightMs).toBe(LONDON_MIDNIGHT);
  });

  it('незачеплене не змінюється: інші події, індекси країн, ланцюжки', () => {
    expect(patched.eventsById.get('evt_london_2027')).toBe(data.eventsById.get('evt_london_2027'));
    expect(patched.countriesByIso).toBe(data.countriesByIso);
    expect(patched.chainsByEventId).toBe(data.chainsByEventId);
    expect(data.eventsById.get('evt_paris_2027')!.midnightMs).toBe(PARIS_MIDNIGHT);
  });

  it('той самий набір моментів у новому знімку — той самий об’єкт', () => {
    expect(withEventPatches(data, { evt_paris_2027: { moment: moved } })).toBe(patched);
    expect(withEventPatches(data, { evt_paris_2027: { moment: moved - MIN } })).not.toBe(patched);
  });
});

describe('scheduleNow (підказка графіка головної) іде за поправкою моменту (AC-53)', () => {
  it('поправка −20 хв: збіг півночі рахується за даними з поправками, не за незміненими', async () => {
    const { scheduleNow } = await import('@/lib/live/homeData');
    const moved = PARIS_MIDNIGHT - 20 * MIN;
    const patched = withEventPatches(data, { evt_paris_2027: { moment: moved }, evt_berlin_2027: { moment: moved } });
    const current = patched.eventsById.get('evt_paris_2027')!;
    const schedule = ['evt_berlin_2027'];
    expect(scheduleNow(patched, schedule, current)).not.toBeNull();
    // На незмінених даних Берлін лишається на старій півночі — збігу немає (саме так було до виправлення).
    expect(scheduleNow(data, schedule, current)).toBeNull();
    // Без поправки — як і раніше.
    const own = data.eventsById.get('evt_paris_2027')!;
    expect(scheduleNow(withEventPatches(data, undefined), schedule, own)).toEqual(scheduleNow(data, schedule, own));
  });
});
