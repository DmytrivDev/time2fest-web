import { screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { withStatus, type EventCardItem } from '@/components/live/eventCards';
import { TvKeyHints } from '@/components/tv/TvKeyHints';
import { TvQueueCard } from '@/components/tv/TvQueueCard';
import { sidebarMode } from '@/components/tv/TvSidebar';
import { TvStampCard } from '@/components/tv/TvStampCard';
import { firstRowShortUrl, firstRowUrl, placeholderShortCode, shareShortUrl, shareUrl } from '@/lib/config/site';
import { getData } from '@/lib/data/load';
import { filterTimeline, queueAfter, remainingFest, tvEvents } from '@/lib/tv/tvData';
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
  const items = tvEvents(data, LONDON - 22 * 60_000, []);
  const londonId = 'evt_london_2027';

  it('усі слоти свята за часом півночі', () => {
    expect(items.length).toBeGreaterThan(10);
    const times = items.map((i) => i.midnightMs);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(items.some((i) => i.id === londonId)).toBe(true);
  });

  it('черга «Далі» — лише події після поточної, не більше ліміту', () => {
    const queue = queueAfter(items, LONDON);
    expect(queue.length).toBeGreaterThan(0);
    expect(queue.every((i) => i.midnightMs > LONDON)).toBe(true);
    expect(queueAfter(items, LONDON, { limit: 2 })).toHaveLength(2);
  });

  it('«Найближчі трансляції»: лише наживо або очікується', () => {
    const queue = queueAfter(items, LONDON, { onlyStreams: true });
    expect(queue.every((i) => i.stream === 'live' || i.stream === 'expected')).toBe(true);
  });

  it('фільтри таймлайну; поточна подія лишається завжди', () => {
    const all = filterTimeline(items, { onlyStreams: false, mySchedule: false }, londonId);
    expect(all).toHaveLength(items.length);
    const marked: EventCardItem[] = withStatus(
      0,
      items.map((i) => ({ ...i, inSchedule: i.id === 'evt_paris_2027' })),
    );
    const mine = filterTimeline(marked, { onlyStreams: false, mySchedule: true }, londonId);
    expect(mine.map((i) => i.id).sort()).toEqual([londonId, 'evt_paris_2027'].sort());
  });

  it('скільки поясів лишилось і коли остання північ', () => {
    const before = remainingFest(data, LONDON - 22 * 60_000);
    const after = remainingFest(data, LONDON + 60_000);
    expect(after.zones).toBeLessThan(before.zones);
    expect(before.endMs).toBe(data.zones[data.zones.length - 1]!.midnightMs);
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
  it('TvQueueCard: посилання на сторінку країни, статус текстом, час за часом глядача', () => {
    const item = tvEvents(data, LONDON - 22 * 60_000, []).find((i) => i.stream === 'countdown-only' && i.midnightMs > LONDON)!;
    renderWithApp(<TvQueueCard item={item} initial />, '2026-12-31T23:38:00Z');
    const link = screen.getByRole('link');
    expect(link.getAttribute('href')).toBe(item.href.replace(/\/$/, ''));
    expect(link).toHaveAttribute('data-tv-initial');
    expect(within(link).getByText('Лише відлік')).toBeInTheDocument();
    expect(within(link).getByText('за вашим часом')).toBeInTheDocument();
  });

  it('TvStampCard: QR з видимою короткою адресою, без кнопок', () => {
    renderWithApp(<TvStampCard eventId="evt_london_2027" city="Лондон" countryName="Велика Британія" illustrationId="gb-postcard" />);
    expect(screen.getByText(shareShortUrl('evt_london_2027'))).toBeVisible();
    expect(screen.getByRole('img', { name: /QR-код/ })).toBeInTheDocument();
    expect(screen.getByText('Скануй, щоб поділитися')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('TvStampCard: «Перший ряд» — подвійна рамка', () => {
    renderWithApp(
      <TvStampCard eventId="evt_london_2027" city="Лондон" countryName="Велика Британія" illustrationId="gb-postcard" firstRowSeat={3} />,
    );
    expect(document.querySelector('[data-first-row="true"] [data-frame="inner"]')).not.toBeNull();
  });

  it('TvKeyHints: підказка клавіш', () => {
    renderWithApp(<TvKeyHints />);
    expect(screen.getByText('вийти з режиму вечірки')).toBeInTheDocument();
    expect(screen.getByText('відкрити')).toBeInTheDocument();
  });
});
