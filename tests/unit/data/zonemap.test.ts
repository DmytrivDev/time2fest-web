// Юніт (дані): мапа поясів `data/zonemap.json` — стара мапа Time2Fest + пояси на ніч 31.12.2026 (scripts/zonemap-v2,
// рішення власника 2026-11-02).
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MAP_CITY_IDS, pointToPercent, utcLabel, type ZoneMapGeometry } from '@/lib/map/model';
import type { ScheduleFile } from '@/lib/data/types';

const root = resolve(__dirname, '../../..');
const jsonPath = resolve(root, 'data/zonemap.json');
const geo = JSON.parse(readFileSync(jsonPath, 'utf8')) as ZoneMapGeometry & { meta: { source: string; projection: string } };
const schedule = JSON.parse(readFileSync(resolve(root, 'data/schedule.json'), 'utf8')) as ScheduleFile;
const allCities = schedule.zones.flatMap((z) => z.countries.flatMap((c) => c.cities));

const fmt = (min: number) => {
  const a = Math.abs(min);
  const m = a % 60;
  return `${min < 0 ? '-' : '+'}${Math.floor(a / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
};

describe('zonemap.json', () => {
  it('38 поясів від UTC+14 до UTC−12, ті самі, що в schedule.json, зі своїми зсувами', () => {
    expect(geo.zones).toHaveLength(38);
    expect(geo.zones[0]!.zoneId).toBe('utc+1400');
    expect(geo.zones.at(-1)!.zoneId).toBe('utc-1200');
    const byId = new Map(schedule.zones.map((z) => [z.id, z]));
    for (const z of geo.zones) {
      const s = byId.get(z.zoneId);
      expect(s).toBeDefined();
      expect(z.offsetMinutes).toBe(s!.offsetMinutes);
      expect(z.offset).toBe(fmt(s!.offsetMinutes));
    }
  });

  it('кожен пояс має суходіл; цілогодинні — ще й смугу в океані; дрібні пояси — маркер (Кірітіматі, Чатем)', () => {
    for (const z of geo.zones) {
      expect(z.countries.map((c) => c.d).join('').length).toBeGreaterThan(20);
      // Пояси з хвилинами (Іран, Індія, Непал, М’янма, центр Австралії, Чатем…) — лише суходіл.
      if (z.offsetMinutes % 60 === 0) expect((z.band ?? '').length).toBeGreaterThan(20);
    }
    expect(geo.markers.map((m) => m.zoneId)).toEqual(expect.arrayContaining(['utc+1400', 'utc+1345']));
  });

  it('лінії: кордони, межі поясів, кордони в морі, лінія зміни дат; області островів у межах полотна', () => {
    for (const k of ['borders', 'zoneLines', 'sea', 'dayline'] as const) expect((geo[k] ?? '').length).toBeGreaterThan(100);
    expect(geo.areas?.length).toBe(4); // Лакшадвіп, Андамани й Нікобари, Мальдіви, Маркізькі
    for (const a of geo.areas ?? []) {
      expect(a.x0).toBeGreaterThanOrEqual(0);
      expect(a.x1).toBeLessThanOrEqual(geo.meta.width);
      expect(a.y0).toBeLessThan(a.y1);
    }
  });

  it('походження: стара мапа + tzdata 2026f; проекція Міллера в кадрі 1781×911', () => {
    expect(geo.meta.source).toMatch(/2026f/);
    expect(geo.meta.projection).toMatch(/miller/);
    expect([geo.meta.width, geo.meta.height]).toEqual([1781, 911]);
  });

  it('розмір ≤ 450 КБ (вантажиться окремим шматком, коли мапа близько)', () => {
    expect(statSync(jsonPath).size).toBeLessThanOrEqual(450 * 1024);
  });

  it('точка підпису кожного поясу лежить усередині полотна', () => {
    for (const z of geo.zones) {
      expect(z.label[0]).toBeGreaterThanOrEqual(0);
      expect(z.label[0]).toBeLessThanOrEqual(geo.meta.width);
      expect(z.label[1]).toBeGreaterThanOrEqual(0);
      expect(z.label[1]).toBeLessThanOrEqual(geo.meta.height);
    }
  });

  it('mapPoint усіх міст потрапляє у видиму частину мапи (0–100 %)', () => {
    for (const city of allCities) {
      const p = pointToPercent(city.mapPoint, geo.meta);
      expect(p.left).toBeGreaterThanOrEqual(0);
      expect(p.left).toBeLessThanOrEqual(100);
      expect(p.top).toBeGreaterThanOrEqual(0);
      expect(p.top).toBeLessThanOrEqual(100);
    }
  });

  it('усі 20 міст мапи є в розкладі (разом із Лас-Вегасом)', () => {
    const ids = new Set(allCities.map((c) => c.id));
    for (const id of MAP_CITY_IDS) expect(ids.has(id)).toBe(true);
  });

  it('Лондон стоїть там, де на мапі Великої Британії (46.6 % / ~33 %)', () => {
    const london = allCities.find((c) => c.id === 'london')!;
    const p = pointToPercent(london.mapPoint, geo.meta);
    expect(p.left).toBeCloseTo(46.6, 0);
    expect(Math.abs(p.top - 32.5)).toBeLessThan(1.5);
  });
});

describe('utcLabel', () => {
  it('UTC+0, UTC+5:45, UTC−9:30', () => {
    expect(utcLabel(0)).toBe('UTC+0');
    expect(utcLabel(345)).toBe('UTC+5:45');
    expect(utcLabel(-570)).toBe('UTC−9:30');
  });
});
