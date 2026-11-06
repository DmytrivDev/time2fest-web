import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TvKeyHints } from '@/components/tv/TvKeyHints';
import { TvTimelineCard } from '@/components/tv/TvTimelineCard';
import { tvRoomy, tvScale } from '@/components/tv/TvScreen';
import { sidebarMode } from '@/components/tv/TvSidebar';
import { TvStampCard } from '@/components/tv/TvStampCard';
import { firstRowShortUrl, firstRowUrl, placeholderShortCode, shareShortUrl, shareUrl } from '@/lib/config/site';
import { getData } from '@/lib/data/load';
import { filterTimeline, nearestLive, remainingFest, tvTimeline, zoneLiveRows } from '@/lib/tv/tvData';
import { pickNext } from '@/lib/tv/useRemoteKeys';
import { renderWithApp } from '../_support/render';

vi.stubGlobal('matchMedia', (query: string) => ({
  matches: false,
  media: query,
  addEventListener: () => undefined,
  removeEventListener: () => undefined,
  addListener: () => undefined,
  removeListener: () => undefined,
  dispatchEvent: () => false,
  onchange: null,
}));

const data = getData();
const LONDON = Date.parse('2027-01-01T00:00:00Z');

describe('lib/config/site — плейсхолдер короткої адреси', () => {
  it('видима адреса штампа: time2fest.com/s/<код>, код детермінований', () => {
    expect(shareShortUrl('evt_london_2027')).toMatch(/^time2fest\.com\/s\/[0-9A-Z]{4}$/);
    expect(shareShortUrl('evt_london_2027')).toBe(shareShortUrl('evt_london_2027'));
    expect(placeholderShortCode('a')).not.toBe(placeholderShortCode('b'));
  });
  it('QR кодує повну адресу з протоколом', () => {
    expect(shareUrl('evt_london_2027')).toBe(`https://${shareShortUrl('evt_london_2027')}`);
    expect(firstRowShortUrl('evt_london_2027')).toBe('time2fest.com/first-row/london');
    expect(firstRowUrl('evt_london_2027')).toBe('https://time2fest.com/first-row/london');
  });
});

describe('lib/tv/tvData', () => {
  const items = tvTimeline(data, LONDON - 22 * 60_000, []);
  const londonId = 'evt_london_2027';

  it('програма: по одній події на слот ефіру, за часом півночі, з поясом', () => {
    expect(items.length).toBeGreaterThan(10);
    const times = items.map((i) => i.midnightMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(new Set(times).size).toBe(items.length);
    expect(items.every((i) => i.program)).toBe(true);
    expect(items.find((i) => i.id === londonId)?.utc).toBe('UTC+0');
  });

  it('події графіка — поруч із програмою свого часу, програма першою', () => {
    const extra = data.events.find((e) => e.midnightMs === LONDON && e.id !== londonId && !items.some((i) => i.id === e.id))!;
    const withMine = tvTimeline(data, LONDON - 22 * 60_000, [extra.id]);
    expect(withMine).toHaveLength(items.length + 1);
    const at = withMine.filter((i) => i.midnightMs === LONDON);
    expect(at[0]!.program).toBe(true);
    expect(at.find((i) => i.id === extra.id)).toMatchObject({ program: false, inSchedule: true });
  });

  it('фільтри таймлайну; подія на екрані лишається завжди', () => {
    expect(filterTimeline(items, 'all', londonId)).toHaveLength(items.length);
    const live = filterTimeline(items, 'live', null);
    expect(live.every((i) => i.stream === 'live' || i.stream === 'expected')).toBe(true);
    const marked = items.map((i) => ({ ...i, inSchedule: i.id === 'evt_paris_2027' }));
    const mine = filterTimeline(marked, 'mine', londonId);
    expect(mine.map((i) => i.id).sort()).toEqual([londonId, 'evt_paris_2027'].sort());
  });

  it('«Змінити трансляцію» — лише трансляції поясу наживо; сцена — найближча наживо з наступних поясів', () => {
    const now = LONDON - 5 * 60_000;
    const zoneId = data.eventsById.get(londonId)!.zoneId;
    const rows = zoneLiveRows(data, zoneId, now);
    expect(rows.every((r) => r.status === 'live' && data.eventsById.get(r.eventId)!.zoneId === zoneId)).toBe(true);
    const near = nearestLive(data, LONDON, now);
    if (near) {
      expect(near.midnightMs).toBeGreaterThan(LONDON);
      expect(near.status).toBe('live');
    }
  });

  it('скільки поясів лишилось і коли остання північ', () => {
    const before = remainingFest(data, LONDON - 22 * 60_000);
    const after = remainingFest(data, LONDON + 60_000);
    expect(after.zones).toBeLessThan(before.zones);
    expect(before.endMs).toBe(data.zones[data.zones.length - 1]!.midnightMs);
  });
});

describe('tvScale (пропорційний масштаб макета 1920 × 1080)', () => {
  it.each([
    [1920, 1080, 1, 1920, 1080],
    [3840, 2160, 2, 1920, 1080],
    [1280, 720, 1280 / 1920, 1920, 1080],
  ])('%i×%i — той самий макет', (w, h, scale, width, height) => {
    const r = tvScale(w, h);
    expect(r.scale).toBeCloseTo(scale, 6);
    expect(r.width).toBeCloseTo(width, 6);
    expect(r.height).toBeCloseTo(height, 6);
  });
  it('ширше — зайве місце ширині макета; вище — висоті; макет завжди цілий', () => {
    const wide = tvScale(1920, 912);
    expect(wide.height).toBeCloseTo(1080, 6);
    expect(wide.width).toBeGreaterThan(1920);
    const tall = tvScale(1280, 1024);
    expect(tall.width).toBeCloseTo(1920, 6);
    expect(tall.height).toBeGreaterThan(1080);
  });
});

describe('tvRoomy (компактний таймлайн)', () => {
  it('16:9 — відео й повний таймлайн влазять, нічого не змінюється', () => {
    expect(tvRoomy(1920, 1080)).toBe(false);
  });
  it('ширше вікно (1920 × 912 → макет 2274 × 1080) — таймлайн компактний', () => {
    const { width, height } = tvScale(1920, 912);
    expect(tvRoomy(width, height)).toBe(true);
  });
  it('вище вікно (4:3) — ні', () => {
    const { width, height } = tvScale(1280, 1024);
    expect(tvRoomy(width, height)).toBe(false);
  });
});

describe('sidebarMode', () => {
  const place = {} as never;
  it.each([
    [{ ready: false, current: null, momentFired: false, view: undefined }, 'loading'],
    [{ ready: true, current: null, momentFired: false, view: 'festival-over' }, 'over'],
    [{ ready: true, current: place, momentFired: false, view: 'stream' }, 'live'],
    [{ ready: true, current: place, momentFired: false, view: 'countdown-scene' }, 'scene'],
    [{ ready: true, current: place, momentFired: false, view: 'expected-scene' }, 'scene'],
    [{ ready: true, current: place, momentFired: true, view: 'stream' }, 'moment'],
    [{ ready: true, current: place, momentFired: true, view: 'countdown-scene' }, 'moment'],
  ] as const)('%o → %s', (input, mode) => {
    expect(sidebarMode(input)).toBe(mode);
  });
});

describe('pickNext (стрілки пульта)', () => {
  const box = (cx: number, cy: number, w = 100, h = 50) => {
    const rect = { left: cx - w / 2, right: cx + w / 2, top: cy - h / 2, bottom: cy + h / 2, width: w, height: h } as DOMRect;
    return { el: document.createElement('button'), cx, cy, rect };
  };
  it('вниз — найближчий елемент знизу, а не збоку', () => {
    const from = box(100, 100);
    const below = box(100, 200);
    const farBelow = box(100, 400);
    const side = box(300, 110);
    expect(pickNext(from.rect, [farBelow, side, below], 'down')).toBe(below.el);
  });
  it('вліво й вправо не повертають елемент у протилежному напрямку', () => {
    const from = box(300, 100);
    const left = box(100, 100);
    const right = box(500, 100);
    expect(pickNext(from.rect, [left, right], 'right')).toBe(right.el);
    expect(pickNext(from.rect, [left, right], 'left')).toBe(left.el);
    expect(pickNext(from.rect, [left], 'right')).toBeNull();
  });
});

describe('компоненти ТВ', () => {
  it('TvTimelineCard: кнопка з часом і поясом, стан текстом, «Програма», дія для зчитувача', () => {
    const item = tvTimeline(data, LONDON - 22 * 60_000, []).find((i) => i.stream === 'countdown-only' && i.midnightMs > LONDON)!;
    renderWithApp(<TvTimelineCard item={item} initial action="schedule-add" />, '2026-12-31T23:38:00Z');
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('data-tv-initial');
    expect(btn).toHaveAttribute('data-program');
    expect(within(btn).getByText('Лише відлік')).toBeInTheDocument();
    expect(within(btn).getByText('Програма')).toBeInTheDocument();
    expect(within(btn).getByText(item.utc)).toBeInTheDocument();
    expect(btn).toHaveAccessibleName(/OK — додати в графік/);
  });

  it('TvStampCard: QR з видимою короткою адресою, без кнопок', () => {
    renderWithApp(<TvStampCard eventId="evt_london_2027" city="Лондон" countryName="Велика Британія" flagCode="GB" illustrationId="gb-postcard" />);
    expect(screen.getByText(shareShortUrl('evt_london_2027'))).toBeVisible();
    expect(screen.getByRole('img', { name: /QR-код/ })).toBeInTheDocument();
    expect(screen.getByText('Скануй, щоб поділитися')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('TvStampCard: «Перший ряд» — подвійна рамка', () => {
    renderWithApp(
      <TvStampCard eventId="evt_london_2027" city="Лондон" countryName="Велика Британія" flagCode="GB" illustrationId="gb-postcard" firstRowSeat={3} />,
    );
    expect(document.querySelector('[data-stamp="tv"][data-first-row="true"] [data-row="first-row"]')).not.toBeNull();
  });

  it('TvKeyHints: підказка клавіш', () => {
    renderWithApp(<TvKeyHints />);
    expect(screen.getByText('вийти з режиму вечірки')).toBeInTheDocument();
    expect(screen.getByText('відкрити · у графік')).toBeInTheDocument();
  });
});
