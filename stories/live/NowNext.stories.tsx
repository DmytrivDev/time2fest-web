import type { Meta, StoryObj } from '@storybook/nextjs';
import { NowNext } from '@/components/live/NowNext';
import { Stage } from '../_support/Stage';
import { STRIP, sceneTime } from '../_support/liveFixtures';

const meta = {
  title: 'Живий ефір/NowNext',
  component: NowNext,
  parameters: { time: sceneTime },
  args: {
    items: STRIP,
    zoneLabel: 'Київ',
    mapHref: '#map',
    progress: {
      hoursPassed: 13,
      hoursTotal: 26,
      zonesDone: 23,
      zonesTotal: 38,
      startLabel: '12:00 · Кірибаті',
      endLabel: '14:00 · 1 січня',
    },
  },
} satisfies Meta<typeof NowNext>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  name: 'Десктоп: карусель (одна минула картка зліва)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <NowNext {...args} layout="carousel" />
    </Stage>
  ),
};

export const FilterOn: Story = {
  name: 'Фільтр «Лише з трансляціями» увімкнено',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <NowNext {...args} defaultFilterLiveOnly />
    </Stage>
  ),
};

export const EmptyAfterFilter: Story = {
  name: 'Порожньо після фільтра',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <NowNext {...args} items={args.items.filter((i) => i.stream === 'possible' || i.stream === 'countdown-only')} defaultFilterLiveOnly />
    </Stage>
  ),
};

export const Loading: Story = {
  name: 'l — завантаження',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <NowNext {...args} loading />
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон: 4 картки і «Показати ще N»',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <NowNext {...args} layout="stack" />
    </Stage>
  ),
};

export const PhoneLoading: Story = {
  name: 'Телефон: l',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <NowNext {...args} layout="stack" loading />
    </Stage>
  ),
};

export const PhoneEmpty: Story = {
  name: 'Телефон: порожньо після фільтра',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <NowNext {...args} layout="stack" items={args.items.filter((i) => i.stream === 'possible')} defaultFilterLiveOnly />
    </Stage>
  ),
};
