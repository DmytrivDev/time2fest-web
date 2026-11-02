// T021: інваріанти 1-9 з specs/001-live-viewing/contracts/schedule.md
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { CountriesFile, ScheduleFile } from '@/lib/data/types';

const dataDir = resolve(__dirname, '../../../data');
const schedule = JSON.parse(readFileSync(resolve(dataDir, 'schedule.json'), 'utf8')) as ScheduleFile;
const countriesFile = JSON.parse(readFileSync(resolve(dataDir, 'countries.json'), 'utf8')) as CountriesFile;
const zones = schedule.zones;
const countries = countriesFile.countries;
const countryByIso = new Map(countries.map((c) => [c.iso, c]));

const allCities = zones.flatMap((z) => z.countries.flatMap((cn) => cn.cities.map((city) => ({ z, cn, city }))));

describe('schedule.json: інваріанти контракту', () => {
  it('заголовок файлу: версія, сезон, tzdb 2026f', () => {
    expect(schedule.version).toBe(1);
    expect(schedule.season).toBe('2026-27');
    expect(schedule.tzdbVersion).toBe('2026f');
    expect(schedule.generatedAt).toMatch(/Z$/);
  });

  it('1. рівно 38 поясів; перший UTC+14, останній UTC-12; order послідовний', () => {
    expect(zones).toHaveLength(38);
    expect(zones[0]!.offsetMinutes).toBe(14 * 60);
    expect(zones[0]!.id).toBe('utc+1400');
    expect(zones.at(-1)!.offsetMinutes).toBe(-12 * 60);
    expect(zones.at(-1)!.id).toBe('utc-1200');
    zones.forEach((z, i) => expect(z.order).toBe(i));
  });

  it('2. midnightUtc унікальні, зростають з order, у форматі UTC (Z)', () => {
    const times = zones.map((z) => Date.parse(z.midnightUtc));
    for (const z of zones) expect(z.midnightUtc).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    expect(new Set(times).size).toBe(zones.length);
    for (let i = 1; i < times.length; i++) expect(times[i]!).toBeGreaterThan(times[i - 1]!);
    // midnightUtc = 2027-01-01T00:00 місцевого - зсув
    for (const z of zones) {
      expect(Date.parse(z.midnightUtc)).toBe(Date.UTC(2027, 0, 1) - z.offsetMinutes * 60_000);
    }
  });

  it('3. кожна подія має midnightUtc свого поясу', () => {
    for (const { z, city } of allCities) {
      expect(city.events.length).toBeGreaterThanOrEqual(1);
      for (const ev of city.events) expect(ev.midnightUtc).toBe(z.midnightUtc);
    }
  });

  it('4. пара (iso, zoneId): одне місто isCountryMain і одна подія isMainCelebration', () => {
    for (const z of zones) {
      for (const cn of z.countries) {
        const mains = cn.cities.filter((c) => c.isCountryMain);
        const celebrations = cn.cities.flatMap((c) => c.events).filter((e) => e.isMainCelebration);
        expect(mains, `${cn.iso} ${z.id}`).toHaveLength(1);
        expect(celebrations, `${cn.iso} ${z.id}`).toHaveLength(1);
      }
    }
  });

  it('5. iso існує в countries.json, а zoneIds країн збігаються з розкладом', () => {
    const seen = new Map<string, Set<string>>();
    for (const z of zones) {
      for (const cn of z.countries) {
        expect(countryByIso.has(cn.iso), cn.iso).toBe(true);
        (seen.get(cn.iso) ?? seen.set(cn.iso, new Set()).get(cn.iso)!).add(z.id);
      }
    }
    for (const c of countries) {
      expect([...c.zoneIds].sort(), c.iso).toEqual([...(seen.get(c.iso) ?? [])].sort());
      expect(c.zoneIds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('6. усі id унікальні; eventId = evt_<cityId>_2027', () => {
    const ids = new Set<string>();
    for (const { city } of allCities) {
      expect(ids.has(city.id), city.id).toBe(false);
      ids.add(city.id);
      for (const ev of city.events) {
        expect(ev.id).toBe(`evt_${city.id}_2027`);
        expect(ids.has(ev.id), ev.id).toBe(false);
        ids.add(ev.id);
      }
    }
    expect(new Set(zones.map((z) => z.id)).size).toBe(zones.length);
    expect(new Set(countries.map((c) => c.iso)).size).toBe(countries.length);
    expect(new Set(countries.map((c) => c.slug)).size).toBe(countries.length);
  });

  it('7. firstRow лише в основних подіях', () => {
    for (const { city } of allCities) {
      for (const ev of city.events) {
        if (ev.firstRow) expect(ev.isMainCelebration, ev.id).toBe(true);
      }
    }
  });

  it('8. країни без роду допускаються (рід лише m|f|n|pl|null)', () => {
    for (const c of countries) expect(['m', 'f', 'n', 'pl', null]).toContain(c.gender);
  });

  it('9. назви країн і міст - непорожній називний, без шаблонних плейсхолдерів', () => {
    for (const c of countries) {
      expect(c.name.uk.trim().length, c.iso).toBeGreaterThan(0);
      expect(c.name.uk).not.toMatch(/[{}<>]/);
      expect(c.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(c.howTo.traditions).toHaveLength(3);
      expect([0, 3]).toContain(c.howTo.gallery?.length ?? 0);
    }
    for (const { city } of allCities) {
      expect(city.name.uk.trim().length, city.id).toBeGreaterThan(0);
      expect(city.mapPoint.x).toBeGreaterThanOrEqual(0);
      expect(city.mapPoint.x).toBeLessThanOrEqual(1);
      expect(city.mapPoint.y).toBeGreaterThanOrEqual(0);
      expect(city.mapPoint.y).toBeLessThanOrEqual(1);
    }
  });

  it('representativeCityId існує всередині свого поясу', () => {
    for (const z of zones) {
      const cityIds = z.countries.flatMap((cn) => cn.cities.map((c) => c.id));
      expect(cityIds, z.id).toContain(z.representativeCityId);
    }
  });

  it('виняткові пояси: Сідней +11, Окленд +13, Чатем +13:45', () => {
    const offsetOf = (cityId: string) => allCities.find((x) => x.city.id === cityId)!.z.offsetMinutes;
    expect(offsetOf('sydney')).toBe(11 * 60);
    expect(offsetOf('auckland')).toBe(13 * 60);
    expect(offsetOf('chatham')).toBe(13 * 60 + 45);
    expect(offsetOf('london')).toBe(0);
  });
});
