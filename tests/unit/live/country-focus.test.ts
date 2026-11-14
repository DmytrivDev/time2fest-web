/** Посилання на сторінку країни з поясом / подією (власник 2026-11-10: «щоб перекидало на те, на що клікнув»). */
import { describe, expect, it } from 'vitest';
import { countryFocusFrom } from '@/components/country/countryHelpers';
import { getData } from '@/lib/data/load';
import { nowNextItems } from '@/lib/live/homeData';
import { countryHref } from '@/lib/live/countryHref';

const data = getData();
const br = data.countriesByIso.get('BR')!;

describe('countryHref', () => {
  it('без уточнення — сторінка країни; з подією — ?e=, з поясом — ?zone= (закодовано)', () => {
    expect(countryHref(br)).toBe('/country/brazyliia/');
    expect(countryHref(br, { eventId: 'evt_rio-de-janeiro_2027' })).toBe('/country/brazyliia/?e=evt_rio-de-janeiro_2027');
    expect(countryHref(br, { zoneId: 'utc+0100' })).toBe('/country/brazyliia/?zone=utc%2B0100');
  });

  it('«Зараз і далі»: картка Ріо-де-Жанейро веде саме на Ріо', () => {
    const items = nowNextItems(data, Date.parse('2027-01-01T03:55:00+02:00'), []);
    const rio = items.find((i) => i.id === 'evt_rio-de-janeiro_2027');
    expect(rio?.href).toBe('/country/brazyliia/?e=evt_rio-de-janeiro_2027');
  });
});

describe('countryFocusFrom', () => {
  const zones = br.zoneIds;
  it('подія цієї країни → її пояс і подія; пояс країни → пояс', () => {
    expect(countryFocusFrom(data, 'BR', zones, 'evt_rio-de-janeiro_2027', null)).toEqual({ zoneId: 'utc-0300', eventId: 'evt_rio-de-janeiro_2027' });
    expect(countryFocusFrom(data, 'BR', zones, null, 'utc-0400')).toEqual({ zoneId: 'utc-0400', eventId: null });
  });
  it('чужа подія чи чужий пояс — нічого (пояс за замовчуванням)', () => {
    expect(countryFocusFrom(data, 'BR', zones, 'evt_perth_2027', null)).toBeNull();
    expect(countryFocusFrom(data, 'BR', zones, null, 'utc+0800')).toBeNull();
    expect(countryFocusFrom(data, 'BR', zones, null, null)).toBeNull();
  });
});
