/**
 * AC-54: рушій ефіру (слот, передача ефіру) і штамп рахують за виправленим моментом події; без поправки — ті самі
 * результати, що й на каталозі.
 */
import { describe, expect, it } from 'vitest';
import { buildDataset } from '@/lib/data/build';
import { withEventPatches } from '@/lib/data/patched';
import { currentAirEvent } from '@/lib/engine/currentAirEvent';
import { buildStamp } from '@/lib/engine/stamp';
import { MIN, miniSchedule, PARIS_MIDNIGHT, SEC } from '../fixtures/data';

const { schedule, countries, streams } = miniSchedule();
const data = buildDataset(schedule, countries, streams);
const moved = PARIS_MIDNIGHT - 20 * MIN;
const patched = withEventPatches(data, { evt_paris_2027: { moment: moved } });

describe('виправлений момент у рушії ефіру й штампі', () => {
  it('поправка −20 хв: слот, передача ефіру й час штампа йдуть за новим моментом', () => {
    const air = currentAirEvent(moved - MIN, patched, patched.chainsByEventId);
    expect(air.event!.id).toBe('evt_paris_2027');
    expect(air.event!.midnightMs).toBe(moved);
    expect(air.handoverAt).toBe(moved + 15 * MIN);
    // після нового переходу ефір уже в наступного слота, а за каталогом Париж ще в ефірі
    expect(currentAirEvent(moved + 15 * MIN, patched, patched.chainsByEventId).event!.id).not.toBe('evt_paris_2027');
    expect(currentAirEvent(moved + 15 * MIN, data, data.chainsByEventId).event!.id).toBe('evt_paris_2027');

    const stamp = buildStamp({ event: patched.eventsById.get('evt_paris_2027')!, country: undefined, city: undefined, presenceSource: 'air' });
    expect(stamp.grantedAt).toBe(moved + 15 * SEC);
  });

  it('без поправки: ті самі результати, що на каталозі', () => {
    const same = withEventPatches(data, undefined);
    expect(same).toBe(data);
    const a = currentAirEvent(PARIS_MIDNIGHT + MIN, same, same.chainsByEventId);
    const b = currentAirEvent(PARIS_MIDNIGHT + MIN, data, data.chainsByEventId);
    expect(a).toEqual(b);
    expect(a.handoverAt).toBe(PARIS_MIDNIGHT + 15 * MIN);
    const ev = data.eventsById.get('evt_paris_2027')!;
    expect(buildStamp({ event: ev, country: undefined, city: undefined, presenceSource: 'air' }).grantedAt).toBe(PARIS_MIDNIGHT + 15 * SEC);
  });
});
