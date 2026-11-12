import type { Meta, StoryObj } from '@storybook/nextjs';
import { useLayoutEffect, useMemo, type ReactNode } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { TvControlBar } from '@/components/tv/TvControlBar';
import { TvFullscreenHint, TvKeyHints } from '@/components/tv/TvKeyHints';
import { TvReplayButton } from '@/components/tv/TvSidebar';
import { TvScene } from '@/components/tv/TvScene';
import { TvScreen, type TvScreenProps } from '@/components/tv/TvScreen';
import { TvStreamsNow } from '@/components/tv/TvPanels';
import { TvStampCard } from '@/components/tv/TvStampCard';
import { TvTimelineCard } from '@/components/tv/TvTimelineCard';
import { getData } from '@/lib/data/load';
import { buildStamp } from '@/lib/engine/presence';
import { BroadcastContext, computeBroadcast, type BroadcastState } from '@/lib/player/BroadcastController';
import { tvTimeline, zoneLiveRows } from '@/lib/tv/tvData';
import { useGuestStore } from '@/stores/guest';

/**
 * S-TV, C22 «Режим вечірки» — склад сторінки `/tv` у ширині 1920 (фокус 4 px). Ефір рахується тим самим `computeBroadcast`,
 * що й у застосунку; у Storybook немає `PlayerProvider` і хоста плеєра — на місці відео порожній слот чи сцена відліку.
 * Час глядача — Київ: «північ о 02:00 за вашим часом» для Лондона. Півночі Лондона — 2027-01-01T00:00:00Z.
 * Артборди: TV-Live, TV-Live-HowTo, TV-Live-Timeline, TV-Countdown, TV-Moment (опівночі).
 */
const LONDON = Date.parse('2027-01-01T00:00:00Z');
const MIN = 60_000;
const iso = (offsetMs: number) => new Date(LONDON + offsetMs).toISOString();

/** Ефір на момент `now` без `BroadcastController` (він потребує `PlayerProvider`). */
function broadcastAt(now: number): BroadcastState {
  return { ready: true, now, ...computeBroadcast(now), controlling: true, stayHere: () => undefined, watching: null, watch: () => undefined, setPrefer: () => undefined, suspend: () => undefined };
}

function Stage({ at, stamped = false, children }: { at: number; stamped?: boolean; children: ReactNode }) {
  const value = useMemo(() => broadcastAt(at), [at]);
  // Штамп гостя за поточну подію: на ТВ він з’являється сам, коли гість був присутній опівночі.
  useLayoutEffect(() => {
    const event = value.current?.event;
    if (!stamped || !event) {
      useGuestStore.setState({ stamps: [], schedule: [] });
      return;
    }
    const data = getData();
    const stamp = buildStamp({
      event,
      country: data.countriesByIso.get(event.countryIso),
      city: data.citiesById.get(event.cityId),
      presenceSource: 'tv',
    });
    useGuestStore.setState({ stamps: [stamp] });
  }, [stamped, value]);
  return (
    <BroadcastContext.Provider value={value}>
      <div data-surface="tv" className="bg-background text-tv-text text-text">
        {children}
      </div>
    </BroadcastContext.Provider>
  );
}

type StoryArgs = { offsetMs: number; stamped?: boolean } & TvScreenProps;

const meta = {
  title: 'Режим вечірки/TvScreen',
  globals: { surface: 'tv', viewport: { value: 'tv', isRotated: false } },
  args: { offsetMs: -22 * MIN },
  parameters: { layout: 'fullscreen' },
  render: ({ offsetMs, stamped, ...rest }) => (
    <Stage at={LONDON + offsetMs} stamped={stamped}>
      <TvScreen {...rest} />
    </Stage>
  ),
} satisfies Meta<StoryArgs>;
export default meta;
type Story = StoryObj<typeof meta>;

const at = (offsetMs: number) => ({ time: { at: iso(offsetMs), frozen: true } });

export const Live: Story = {
  name: 'live — TV-Live: Лондон, відлік до півночі, черга «Далі»',
  args: { offsetMs: -22 * MIN },
  parameters: at(-22 * MIN),
};

export const HowTo: Story = {
  name: 'live — TV-Live-HowTo: вкладка «Як святкувати»',
  args: { offsetMs: -22 * MIN },
  parameters: at(-22 * MIN),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('tab', { name: 'Як святкувати' }));
    await expect(await canvas.findByRole('heading', { name: /Як святкувати · / })).toBeVisible();
  },
};

export const Timeline: Story = {
  name: 'timeline відкрито — TV-Live-Timeline: минулі зліва за краєм, поточна перша',
  args: { offsetMs: -22 * MIN },
  parameters: at(-22 * MIN),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Показати все свято: таймлайн подій' }));
    await expect(await canvas.findByRole('button', { name: 'Сховати таймлайн' })).toBeVisible();
  },
};

export const TimelineOnlyStreams: Story = {
  name: 'timeline — фільтр «Лише з трансляціями»',
  args: { offsetMs: -22 * MIN },
  parameters: at(-22 * MIN),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole('button', { name: 'Показати все свято: таймлайн подій' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'Лише з трансляціями' }));
    await expect(await canvas.findByRole('button', { name: 'Лише з трансляціями', pressed: true })).toBeVisible();
  },
};

export const CountdownScene: Story = {
  name: 'countdown-scene — TV-Countdown: трансляції немає, на місці плеєра сцена відліку, черга «Найближчі трансляції»',
  args: { offsetMs: 20 * MIN },
  parameters: at(20 * MIN),
};

export const FiveMinutes: Story = {
  name: 'live — за 5 хв: великого відліку в колонці вже немає, «північ о 02:00 за вашим часом»',
  args: { offsetMs: -4 * MIN },
  parameters: at(-4 * MIN),
};

export const Midnight: Story = {
  name: 'midnight — ТВ опівночі (+15 с): «Велика Британія зустріла Новий рік», штамп з QR',
  args: { offsetMs: 15_000, stamped: true },
  parameters: at(15_000),
};

export const MidnightLit: Story = {
  name: 'midnight — +1 хв: штамп у колонці',
  args: { offsetMs: MIN, stamped: true },
  parameters: at(MIN),
};

export const MidnightNoStamp: Story = {
  name: 'midnight — гість не був присутній: лише «зустріла Новий рік», штампа немає',
  args: { offsetMs: MIN, stamped: false },
  parameters: at(MIN),
};

export const LastMinute: Story = {
  name: 'last-minute — +14:30: «далі через 0:30 · Далі: …»',
  args: { offsetMs: 14 * MIN + 30_000, stamped: true },
  parameters: at(14 * MIN + 30_000),
};

export const ReducedMotion: Story = {
  name: 'зменшити рух — опівночі місця просто з’являються, без руху',
  globals: { surface: 'tv', viewport: { value: 'tv', isRotated: false }, reduceMotion: 'on' },
  args: { offsetMs: 15_000, stamped: true },
  parameters: at(15_000),
};

export const Fullscreen: Story = {
  name: '«На весь екран» — лише відео чи відлік, без колонки й таймлайну',
  args: { offsetMs: -22 * MIN, full: true },
  parameters: at(-22 * MIN),
  play: async ({ canvasElement }) => {
    await expect(canvasElement.querySelector('[data-tv-root][data-full]')).not.toBeNull();
  },
};

export const Offline: Story = {
  name: 'offline — «Немає з’єднання · Відлік іде далі. Відео й чат повернуться самі»',
  args: { offsetMs: -22 * MIN, online: false },
  parameters: at(-22 * MIN),
  play: async ({ canvasElement }) => {
    await expect(await within(canvasElement).findByRole('status')).toHaveTextContent('Немає з’єднання');
  },
};

export const FestivalOver: Story = {
  name: 'свято завершено — після останньої півночі',
  args: { offsetMs: 40 * 60 * MIN },
  parameters: at(40 * 60 * MIN),
};

/** Частини окремо: що саме складає колонку й сцену. */
/** «Змінити трансляцію», коли трансляцій поясу більше, ніж влазить: список гортається (пульт ↓, колесо миші, смуга). */
export const ManyStreams: StoryObj = {
  name: '«Змінити трансляцію» — 8 трансляцій поясу, список гортається',
  globals: { surface: 'tv', viewport: { value: 'tv', isRotated: false } },
  parameters: at(-22 * MIN),
  render: () => {
    const data = getData();
    const rows = zoneLiveRows(data, data.eventsById.get('evt_london_2027')!.zoneId, LONDON - 22 * MIN);
    const many = [...rows, ...rows.map((r) => ({ ...r, id: `${r.id}-2` }))];
    return (
      <Stage at={LONDON - 22 * MIN}>
        <div data-surface="tv" className="flex h-180 w-168 flex-col bg-background p-10">
          <TvStreamsNow rows={many} playingId={rows[0]?.id ?? null} onWatch={() => undefined} onClose={() => undefined} />
        </div>
      </Stage>
    );
  },
};

export const Parts: StoryObj = {
  name: 'частини: TvTimelineCard (статуси), TvStampCard, TvScene, TvControlBar, «Подивитися північ ще раз», підказки',
  globals: { surface: 'tv', viewport: { value: 'tv', isRotated: false } },
  parameters: at(-22 * MIN),
  render: () => {
    const data = getData();
    const items = tvTimeline(data, LONDON - 22 * MIN, []);
    const sample = [
      items.find((i) => i.stream === 'live' && i.midnightMs > LONDON),
      items.find((i) => i.stream === 'expected' && i.midnightMs > LONDON),
      items.find((i) => i.stream === 'possible' && i.midnightMs > LONDON),
      items.find((i) => i.stream === 'countdown-only' && i.midnightMs > LONDON),
    ].filter((i): i is NonNullable<typeof i> => !!i);
    const london = data.countriesByIso.get('GB')!;
    return (
      <Stage at={LONDON - 22 * MIN}>
        <div className="flex flex-col gap-8 p-12">
          <ul className="m-0 flex list-none gap-3 p-0 pt-4">
            {sample.map((item) => (
              <li key={item.id}>
                <TvTimelineCard item={item} action="schedule-add" />
              </li>
            ))}
          </ul>
          <div className="w-112">
            <TvStampCard eventId="evt_london_2027" city="Лондон" countryName={london.name.uk} flagCode={london.flagCode} illustrationId={london.illustrationId} />
          </div>
          <div className="relative h-176 w-336 overflow-hidden">
            <TvScene country={london} cityName="Лондон · Біг-Бен" midnightMs={LONDON} />
          </div>
          <div className="w-112">
            <TvControlBar muted={false} available />
          </div>
          <div className="w-112">
            <TvControlBar muted available />
          </div>
          <div className="w-112">
            <TvControlBar muted available={false} />
          </div>
          <TvReplayButton />
          <TvKeyHints />
          <TvFullscreenHint fullscreen={false} />
        </div>
      </Stage>
    );
  },
};
