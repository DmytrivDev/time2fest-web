// Графік — це країни (рішення власника 2026-11-04): подія тягне за собою інші події тієї самої країни в тому самому поясі.
import { afterEach, describe, expect, it } from 'vitest';
import { getData } from '@/lib/data/load';
import { countryZoneEvents, toggleCountryZone } from '@/lib/schedule/countryZone';
import { useGuestStore } from '@/stores/guest';

const ev = (cityId: string) => getData().events.find((e) => e.cityId === cityId)!.id;

afterEach(() => useGuestStore.setState({ schedule: [] }));

describe('графік — країна в поясі', () => {
  it('Сідней і Мельбурн — один запис; Нью-Йорк — окремо від Лос-Анджелеса (інший пояс)', () => {
    expect(new Set(countryZoneEvents(ev('sydney')))).toEqual(new Set([ev('sydney'), ev('melbourne')]));
    expect(countryZoneEvents(ev('london'))).toEqual([ev('london')]);
    expect(countryZoneEvents(ev('new-york'))).not.toContain(ev('los-angeles'));
    expect(countryZoneEvents('nope')).toEqual(['nope']);
  });

  it('додали одну подію — у графіку обидві; прибрали будь-яку — немає жодної', () => {
    const on = toggleCountryZone([], ev('melbourne'));
    expect(new Set(on)).toEqual(new Set([ev('sydney'), ev('melbourne')]));
    expect(toggleCountryZone(on, ev('sydney'))).toEqual([]);
  });

  it('сховище: toggleSchedule — та сама логіка; інші записи не чіпає', () => {
    useGuestStore.setState({ schedule: [ev('london')] });
    useGuestStore.getState().toggleSchedule(ev('las-vegas'));
    expect(new Set(useGuestStore.getState().schedule)).toEqual(new Set([ev('london'), ev('las-vegas'), ev('los-angeles')]));
    useGuestStore.getState().toggleSchedule(ev('los-angeles'));
    expect(useGuestStore.getState().schedule).toEqual([ev('london')]);
  });
});
