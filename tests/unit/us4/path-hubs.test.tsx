/**
 * Мапа шляху в картці автора — як мапа графіка й паспорта, лише зменшена (правка власника 2026-11-09):
 * вузли поясів (кілька точок одного поясу — вузол і промені), пояси за станом від поточного часу, зустрінуті країни
 * золотом, товщини й розміри точок — від ширини мапи.
 */
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthorPanel, type AuthorPanelProps } from '@/components/live/AuthorPanel';
import { pathMapScale } from '@/components/live/PathMap';
import chatScript from '@/data/chat-script.json';
import zonemap from '@/data/zonemap.json';
import { assignZoneHubs, buildAuthorPath, buildOwnPath, pathSummary, type PathPoint } from '@/lib/chat-sim/authorPath';
import { getData } from '@/lib/data/load';
import type { Author, ChatScriptFile, Stamp } from '@/lib/data/types';
import { renderApp, stubBrowserApis } from '../us1/render';

const script = chatScript as unknown as ChatScriptFile;
const data = getData();
const geometry = zonemap as unknown as NonNullable<AuthorPanelProps['geometry']>;
const HIRO: Author = { id: 'u_hiro', nick: 'Hiro', flagCode: 'JP', badges: ['pass'] };

const pt = (id: string, zoneId: string | undefined, midnightMs: number, planned = false): PathPoint => ({
  id,
  city: id,
  country: id,
  flagCode: 'UA',
  x: 0.5,
  y: 0.5,
  midnightMs,
  planned,
  ...(zoneId ? { zoneId } : {}),
});

describe('assignZoneHubs — вузли поясів', () => {
  it('кілька точок поясу: вузол — перша зустрінута, решта — промені; вузол перед променями', () => {
    const out = assignZoneHubs([pt('b', 'z2', 2), pt('a1', 'z1', 1), pt('a2', 'z1', 1), pt('c', 'z3', 3)]);
    expect(out.map((p) => [p.id, p.hubOf ?? null])).toEqual([
      ['a1', null],
      ['a2', 'a1'],
      ['b', null],
      ['c', null],
    ]);
  });

  it('зустрінута точка — вузол, навіть якщо запланована йде раніше в масиві', () => {
    const out = assignZoneHubs([pt('plan', 'z1', 1, true), pt('met', 'z1', 1)]);
    expect(out.map((p) => [p.id, p.hubOf ?? null])).toEqual([
      ['met', null],
      ['plan', 'met'],
    ]);
  });

  it('лише заплановані — вузол перша з них; точки без поясу лишаються окремими; старий hubOf перераховується', () => {
    const out = assignZoneHubs([
      pt('p1', 'z1', 1, true),
      { ...pt('p2', 'z1', 1, true), hubOf: 'zzz' },
      pt('x', undefined, 1),
      pt('y', undefined, 1),
    ]);
    expect(Object.fromEntries(out.map((p) => [p.id, p.hubOf ?? null]))).toEqual({ p1: null, p2: 'p1', x: null, y: null });
  });
});

describe('шлях автора й власний шлях — з вузлами', () => {
  it('Hiro: Сідней і Мельбурн, Токіо й Сеул, Париж і Берлін — по вузлу з променем у кожному поясі', () => {
    const path = buildAuthorPath(HIRO, script, data);
    const byId = Object.fromEntries(path.map((p) => [p.id, p]));
    expect(byId.evt_melbourne_2027!.hubOf).toBe('evt_sydney_2027');
    expect(byId.evt_seoul_2027!.hubOf).toBe('evt_tokyo_2027');
    expect(byId.evt_berlin_2027!.hubOf).toBe('evt_paris_2027');
    expect(path.filter((p) => !p.hubOf).map((p) => p.id)).toEqual(['evt_sydney_2027', 'evt_tokyo_2027', 'evt_paris_2027']);
    expect(byId.evt_tokyo_2027!.zoneId).toBe('utc+0900');
    expect(byId.evt_tokyo_2027!.countryIso).toBe('JP');
  });

  it('шлях автора: минулі заплановані точки відсіюються, вузол перераховується; без now — усе як є', () => {
    const script2 = {
      ...script,
      authors: [
        ...script.authors,
        {
          id: 'u_test_plan',
          nick: 'Planner',
          flagCode: 'UA',
          badges: ['pass'],
          path: [
            { eventId: 'evt_cairo_2027', planned: true },
            { eventId: 'evt_kyiv_2027', planned: true },
          ],
        },
      ],
    } as unknown as ChatScriptFile;
    const planner: Author = { id: 'u_test_plan', nick: 'Planner', flagCode: 'UA', badges: ['pass'] };
    const cairo = data.eventsById.get('evt_cairo_2027')!;
    const kyiv = data.eventsById.get('evt_kyiv_2027')!;
    expect(buildAuthorPath(planner, script2, data).length).toBe(2);
    // Каїр і Київ — один пояс (utc+0200): пояс минув → обидві точки зникають.
    expect(cairo.zoneId).toBe(kyiv.zoneId);
    expect(buildAuthorPath(planner, script2, data, Math.max(cairo.midnightMs, kyiv.midnightMs) + 1)).toEqual([]);
    const before = buildAuthorPath(planner, script2, data, cairo.midnightMs - 60_000);
    expect(before.map((p) => p.planned)).toEqual([true, true]);
    expect(pathSummary(before)).toEqual({ met: 0, planned: 2 });
  });

  it('власний шлях: вузол поясу — штамп не з кімнати, як на «Моєму графіку»', () => {
    const st = (eventId: string, grantedAt: number, presenceSource: Stamp['presenceSource']): Stamp => ({
      eventId,
      grantedAt,
      presenceSource,
      illustrationId: 'x',
      cityName: '',
      countryIso: '',
    });
    const kyiv = data.eventsById.get('evt_kyiv_2027')!;
    const path = buildOwnPath([st('evt_cairo_2027', 1, 'room'), st('evt_kyiv_2027', 2, 'country')], [], data, kyiv.midnightMs + 60_000);
    expect(path.map((p) => [p.id, p.hubOf ?? null])).toEqual([
      ['evt_kyiv_2027', null],
      ['evt_cairo_2027', 'evt_kyiv_2027'],
    ]);
  });
});

describe('pathMapScale — масштаб точок і ліній від ширини мапи', () => {
  it('мапа графіка на десктопі — базовий розмір; картка автора й телефон — 0.6; невідома ширина — 1', () => {
    expect(pathMapScale(968)).toBe(1);
    expect(pathMapScale(1400)).toBe(1);
    expect(pathMapScale(307)).toBe(0.6);
    expect(pathMapScale(600)).toBeCloseTo(0.79, 2);
    expect(pathMapScale(0)).toBe(1);
  });
});

describe('мапа в картці автора', () => {
  beforeAll(stubBrowserApis);
  afterEach(cleanup);

  it('пояси за станом від поточного часу, зустрінуті країни золотом, промені поясу', () => {
    // 1 січня 2027, 00:03 UTC: Лондон щойно зустрів, пояси Азії минули, Америка попереду.
    renderApp(
      <AuthorPanel author={HIRO} countryName="Японія" hasPass path={buildAuthorPath(HIRO, script, data)} geometry={geometry} />,
      '2027-01-01T00:03:00Z',
    );
    expect(document.querySelector('.t2f-pathmap-zone[data-state="past"]')).not.toBeNull();
    expect(document.querySelector('.t2f-pathmap-zone[data-state="live"]')).not.toBeNull();
    expect(document.querySelector('.t2f-pathmap-zone[data-state="future"]')).not.toBeNull();
    const visited = Array.from(document.querySelectorAll('[data-visited]')).map((el) => el.getAttribute('data-visited'));
    expect(new Set(visited)).toEqual(new Set(['AU', 'JP', 'KR']));
    expect(document.querySelectorAll('line[data-ray]')).toHaveLength(3);
    expect(document.querySelectorAll('button[data-ray]')).toHaveLength(3);
    expect(document.querySelector('[data-dot="last"]')).not.toBeNull();
    expect(document.querySelectorAll('[data-dot="ray-met"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-dot="ray-planned"]')).toHaveLength(1);
  });

  it('без пасу: мапа затемнена, пояси підсвічені, точок і золота немає', () => {
    renderApp(
      <AuthorPanel author={{ id: 'u_taras', nick: 'Тарас', flagCode: 'UA', badges: [] }} hasPass={false} path={[]} geometry={geometry} />,
      '2027-01-01T00:03:00Z',
    );
    expect(document.querySelector('[data-row="locked"] .t2f-pathmap-zone[data-state="live"]')).not.toBeNull();
    expect(document.querySelector('[data-visited]')).toBeNull();
    expect(document.querySelector('[data-point]')).toBeNull();
  });
});
