import { describe, expect, it } from 'vitest';
import { orderCountries } from '@/components/countries/CountryList';
import type { MapCountry } from '@/lib/map/model';

const c = (iso: string, streams = 0) => ({ iso, name: iso, streams: Array.from({ length: streams }, () => ({})) }) as unknown as MapCountry;

describe('orderCountries (п. 12, 23, Т17)', () => {
  it('країни з трансляцією — першими, порядок у частинах збережено', () => {
    const out = orderCountries([c('CH'), c('CZ', 1), c('AT'), c('DE', 2), c('PL')]);
    expect(out.map((x) => x.iso)).toEqual(['CZ', 'DE', 'CH', 'AT', 'PL']);
  });
  it('Росія й Білорусь — наприкінці своєї частини', () => {
    const out = orderCountries([c('RU', 1), c('FR', 1), c('BY'), c('IT')]);
    expect(out.map((x) => x.iso)).toEqual(['FR', 'RU', 'IT', 'BY']);
  });
});
