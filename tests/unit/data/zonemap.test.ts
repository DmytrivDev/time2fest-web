// T067 (юніт, дані): згенерована мапа поясів `public/zonemap.svg` + `data/zonemap.json` (T079).
import { readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pointToPercent, utcLabel, type ZoneMapGeometry } from '@/components/live/MapModel';
import type { ScheduleFile } from '@/lib/data/types';

const root = resolve(__dirname, '../../..');
const svgPath = resolve(root, 'public/zonemap.svg');
const jsonPath = resolve(root, 'data/zonemap.json');
const svg = readFileSync(svgPath, 'utf8');
const geo = JSON.parse(readFileSync(jsonPath, 'utf8')) as ZoneMapGeometry & { meta: { source: string; projection: string } };
const schedule = JSON.parse(readFileSync(resolve(root, 'data/schedule.json'), 'utf8')) as ScheduleFile;

const pathTags = [...svg.matchAll(/<path\b[^>]*>/g)].map((m) => m[0]);
const attr = (tag: string, name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];

describe('zonemap.svg', () => {
  it('має рівно 38 шляхів з data-offset, усі унікальні', () => {
    const withOffset = pathTags.filter((t) => attr(t, 'data-offset') !== undefined);
    expect(withOffset).toHaveLength(38);
    expect(new Set(withOffset.map((t) => attr(t, 'data-offset'))).size).toBe(38);
    expect(new Set(withOffset.map((t) => attr(t, 'data-zone'))).size).toBe(38);
  });

  it('кожен шлях — непорожній d, початковий клас is-ahead (стани лише від TimeSource)', () => {
    for (const tag of pathTags) {
      expect(attr(tag, 'd')?.length ?? 0).toBeGreaterThan(20);
      expect(attr(tag, 'class')).toBe('is-ahead');
    }
  });

  it('data-zone збігається з поясами schedule.json, а data-offset — з їхніми зсувами', () => {
    const fmt = (min: number) => {
      const a = Math.abs(min);
      const m = a % 60;
      return `${min < 0 ? '-' : '+'}${Math.floor(a / 60)}${m ? `:${String(m).padStart(2, '0')}` : ''}`;
    };
    const byZone = new Map(pathTags.map((t) => [attr(t, 'data-zone')!, attr(t, 'data-offset')!]));
    expect([...byZone.keys()].sort()).toEqual(schedule.zones.map((z) => z.id).sort());
    for (const z of schedule.zones) expect(byZone.get(z.id)).toBe(fmt(z.offsetMinutes));
  });

  it('маркери-кружечки для Кірітіматі й Чатема (дрібні пояси)', () => {
    expect(svg).toMatch(/data-zone-marker="utc\+1400"/);
    expect(svg).toMatch(/data-zone-marker="utc\+1345"/);
    expect(geo.markers.map((m) => m.zoneId).sort()).toEqual(['utc+1345', 'utc+1400']);
  });

  it('розмір ≤ ~250 КБ (research.md, розділ 6)', () => {
    expect(statSync(svgPath).size).toBeLessThanOrEqual(250 * 1024);
    expect(statSync(jsonPath).size).toBeLessThanOrEqual(250 * 1024);
  });
});

describe('zonemap.json', () => {
  it('38 поясів, відсортовані від UTC+14 до UTC-12, шляхи ті самі, що в SVG', () => {
    expect(geo.zones).toHaveLength(38);
    expect(geo.zones[0]!.zoneId).toBe('utc+1400');
    expect(geo.zones.at(-1)!.zoneId).toBe('utc-1200');
    const svgD = new Map(pathTags.map((t) => [attr(t, 'data-zone')!, attr(t, 'd')!]));
    for (const z of geo.zones) expect(svgD.get(z.zoneId)).toBe(z.d);
  });

  it('походження: timezone-boundary-builder 2026e, рівнопроміжна проекція', () => {
    expect(geo.meta.source).toMatch(/2026e/);
    expect(geo.meta.projection).toMatch(/equirectangular/);
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
    for (const z of schedule.zones)
      for (const c of z.countries)
        for (const city of c.cities) {
          const p = pointToPercent(city.mapPoint, geo.meta);
          expect(p.left).toBeGreaterThanOrEqual(0);
          expect(p.left).toBeLessThanOrEqual(100);
          expect(p.top).toBeGreaterThanOrEqual(0);
          expect(p.top).toBeLessThanOrEqual(100);
        }
  });

  it('Лондон: mapPoint проектується на нульовий меридіан (50 %)', () => {
    const london = schedule.zones.flatMap((z) => z.countries.flatMap((c) => c.cities)).find((c) => c.id === 'london')!;
    expect(pointToPercent(london.mapPoint, geo.meta).left).toBeCloseTo(49.97, 1);
  });
});

describe('utcLabel', () => {
  it('UTC+0, UTC+5:45, UTC−9:30', () => {
    expect(utcLabel(0)).toBe('UTC+0');
    expect(utcLabel(345)).toBe('UTC+5:45');
    expect(utcLabel(-570)).toBe('UTC−9:30');
  });
});
