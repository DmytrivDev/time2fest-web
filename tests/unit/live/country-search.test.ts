// Пошук країн і міст усіма мовами сайту (рішення власника 2026-11-09): uk/en/es/fr, транслітерація міст,
// англійські назви з id міста й словника, нечутливість до регістру, діакритики, дефісів.
import { describe, expect, it } from 'vitest';
import { buildMapModel, type MapCountry } from '@/lib/map/model';
import { matchCountry } from '@/components/live/CountryList';
import { getData } from '@/lib/data/load';
import { detectFlag } from '@/lib/geo/detectFlag';
import { fold, getSearchIndex, translit } from '@/lib/search/countrySearch';

const data = getData();
const index = getSearchIndex(data);
const countries: MapCountry[] = buildMapModel(data).zones.flatMap((z) => z.countries);
const find = (q: string) => countries.filter((c) => matchCountry(c, fold(q), index)).map((c) => c.iso);
const hits = (q: string) => new Set(find(q));

describe('пошук країн і міст усіма мовами', () => {
  it('англійські назви країн', () => {
    expect(hits('nepal')).toContain('NP');
    expect(hits('India')).toContain('IN');
    expect(hits('Britain')).toContain('GB');
    expect(hits('Ukraine')).toContain('UA');
  });
  it('французькі й іспанські назви', () => {
    expect(hits('Allemagne')).toContain('DE');
    expect(hits('Alemania')).toContain('DE');
    expect(hits('Espagne')).toContain('ES');
    expect(hits('Estados Unidos')).toContain('US');
  });
  it('українські назви працюють, як раніше', () => {
    expect(hits('Непал')).toContain('NP');
    expect(hits('непал')).toContain('NP');
    expect(hits('Кот-д’Івуар')).toContain('CI');
    expect(hits("кот-д'івуар")).toContain('CI');
  });
  it('міста: англійська, транслітерація, діакритика, дефіси', () => {
    expect(hits('new york')).toContain('US');
    expect(hits('New-York')).toContain('US');
    expect(hits('Kyiv')).toContain('UA');
    expect(hits('Kiev')).toContain('UA');
    expect(hits('Rio de Janeiro')).toContain('BR');
    expect(hits('Londres')).toContain('GB');
    expect(hits('Tokio')).toContain('JP');
  });
  it('збіг за містом позначається містом, збіг за країною — ні', () => {
    const us = countries.find((c) => c.iso === 'US')!;
    expect(matchCountry(us, fold('usa'), index)).toEqual({});
    const ua = countries.find((c) => c.iso === 'UA')!;
    expect(matchCountry(ua, fold('kyiv'), index)).toEqual({ city: 'Київ' });
  });
  it('нісенітниця нічого не знаходить', () => {
    expect(find('qqqzzz')).toHaveLength(0);
  });
  it('транслітерація за КМУ-2010', () => {
    expect(translit('Київ')).toBe('kyiv');
    expect(translit('Харків')).toBe('kharkiv');
    expect(translit('Запоріжжя')).toBe('zaporizhzhia');
    expect(translit('Львів')).toBe('lviv');
    expect(translit('Вінниця')).toBe('vinnytsia');
    expect(translit('Згорани')).toBe('zghorany');
  });
  it('fold: регістр, діакритика, дефіси, апострофи', () => {
    expect(fold('São Paulo')).toBe('sao paulo');
    expect(fold("St. John's")).toBe('st johns');
    expect(fold('New-York')).toBe('new york');
  });
  it('прапор за замовчуванням — Україна (імітація IP, 2026-11-09)', () => {
    expect(detectFlag()).toBe('UA');
  });
});
