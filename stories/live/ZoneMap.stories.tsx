import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import { NextIntlClientProvider } from 'next-intl';
import { userEvent, within } from 'storybook/test';
import { MapLegend } from '@/components/live/MapLegend';
import { buildMapModel, type ZoneMapGeometry } from '@/components/live/MapModel';
import { HowToPopover, MapTapCard, ZoneCard, ZoneMap } from '@/components/live/ZoneMap';
import geometryJson from '@/data/zonemap.json';
import { data } from '@/lib/data/load';
import ukMessages from '../../messages/uk.json';
import { Stage, StateRow } from '../_support/Stage';
import { sceneTime } from '../_support/liveFixtures';

const messages = ukMessages;

/** Рядки `liveMap` — з uk.json. */
const withMapMessages: Decorator = (Story) => (
  <NextIntlClientProvider locale="uk" messages={messages as never}>
    <Story />
  </NextIntlClientProvider>
);

const geometry = geometryJson as unknown as ZoneMapGeometry;
const model = buildMapModel(data);
const zoneOf = (id: string) => model.zones.find((z) => z.id === id)!;

const meta = {
  title: 'Живий ефір/ZoneMap',
  component: ZoneMap,
  decorators: [withMapMessages],
  parameters: { time: sceneTime },
  args: { zones: model.zones, cities: model.cities, geometry, layout: 'desktop' },
} satisfies Meta<typeof ZoneMap>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  name: 'Десктоп: Лондон наживо, Азори далі, Європа вже зустріла',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <div className="max-w-2xl">
        <ZoneMap {...args} />
      </div>
    </Stage>
  ),
};

export const DesktopFocusAndCard: Story = {
  name: 'f — фокус на поясі, Enter — ZoneCard',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <div className="max-w-2xl">
        <ZoneMap {...args} />
      </div>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const live = await within(canvasElement).findByRole('button', { name: /північ зараз/ });
    live.focus();
    await userEvent.keyboard('{Enter}');
  },
};

export const PhoneTapCard: Story = {
  name: 'Телефон: дотик до міста — картка під мапою (без переходу)',
  globals: { surface: 'phone' },
  args: { layout: 'phone', defaultView: 'map' },
  render: (args) => (
    <Stage>
      <ZoneMap {...args} />
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const dot = await within(canvasElement).findByRole('button', { name: /^Лондон/ });
    await userEvent.click(dot);
  },
};

export const PhoneZoneCard: Story = {
  name: 'Телефон: дотик до поясу — ZoneCard',
  globals: { surface: 'phone' },
  args: { layout: 'phone', defaultSelectedZoneId: 'utc+0100' },
  render: (args) => (
    <Stage>
      <ZoneMap {...args} />
    </Stage>
  ),
};

export const List: Story = {
  name: 'Список — текстова альтернатива мапі',
  globals: { surface: 'phone' },
  args: { layout: 'phone', defaultView: 'list' },
  render: (args) => (
    <Stage>
      <ZoneMap {...args} />
    </Stage>
  ),
};

export const ListView: Story = {
  name: 'Вкладка «Список»',
  args: { defaultView: 'list' },
  render: (args) => (
    <Stage>
      <ZoneMap {...args} />
    </Stage>
  ),
};

export const BeforeFirstMidnight: Story = {
  name: 'До першої півночі: UTC+14 наживо, усе інше попереду',
  globals: { surface: 'desktop' },
  parameters: { time: { at: '2026-12-31T09:00:00Z', frozen: true } },
  render: (args) => (
    <Stage>
      <div className="max-w-2xl">
        <ZoneMap {...args} />
      </div>
    </Stage>
  ),
};

export const AfterLastMidnight: Story = {
  name: 'Після останньої півночі: усе зустріли',
  globals: { surface: 'desktop' },
  parameters: { time: { at: '2027-01-01T13:00:00Z', frozen: true } },
  render: (args) => (
    <Stage>
      <div className="max-w-2xl">
        <ZoneMap {...args} />
      </div>
    </Stage>
  ),
};

export const ReducedMotion: Story = {
  name: 'Зменшити рух: точка без пульсації',
  globals: { surface: 'desktop', reduceMotion: 'on' },
  render: (args) => (
    <Stage>
      <div className="max-w-2xl">
        <ZoneMap {...args} />
      </div>
    </Stage>
  ),
};

export const Parts: Story = {
  name: 'Частини: MapLegend, ZoneCard, MapTapCard, HowToPopover',
  globals: { surface: 'phone' },
  render: () => {
    const zone = zoneOf('utc+0000');
    const gb = zone.countries[0]!;
    const city = model.cities.find((c) => c.id === 'london')!;
    return (
      <Stage>
        <StateRow label="MapLegend">
          <MapLegend />
        </StateRow>
        <StateRow label="ZoneCard: закріплена (наживо)">
          <ZoneCard zone={zone} state="live" onClose={() => undefined} className="w-full" />
        </StateRow>
        <StateRow label="ZoneCard: попередній перегляд (наведення)">
          <ZoneCard zone={zoneOf('utc+0100')} state="past" pinned className="w-full" />
          <ZoneCard zone={zoneOf('utc-0100')} state="next" pinned={false} className="w-full" />
        </StateRow>
        <StateRow label="MapTapCard: Лондон">
          <MapTapCard city={city} country={gb} zone={zone} state="live" typeLabel="Головне святкування" onClose={() => undefined} className="w-full" />
        </StateRow>
        <StateRow label="MapTapCard: попереду, лише відлік">
          <MapTapCard
            city={model.cities.find((c) => c.id === 'new-york')!}
            country={zoneOf('utc-0500').countries[0]!}
            zone={zoneOf('utc-0500')}
            state="future"
            typeLabel="Лише відлік"
            onClose={() => undefined}
            className="w-full"
          />
        </StateRow>
        <StateRow label="HowToPopover (натисни)">
          <HowToPopover country={gb} />
        </StateRow>
      </Stage>
    );
  },
};
