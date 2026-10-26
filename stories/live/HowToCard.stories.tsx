import type { Meta, StoryObj } from '@storybook/nextjs';
import { HowToCard } from '@/components/live/HowToCard';
import { Stage, StateRow } from '../_support/Stage';
import { withUs1Messages } from '../_support/us1Messages';
import { TRADITIONS } from '../_support/liveFixtures';

const meta = {
  title: 'Живий ефір/HowToCard',
  component: HowToCard,
  decorators: [withUs1Messages],
  args: { country: 'Франція', traditions: TRADITIONS.slice(0, 3) },
} satisfies Meta<typeof HowToCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Full: Story = {
  name: 'Повна: три традиції (десктоп)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <HowToCard {...args} variant="full" />
    </Stage>
  ),
};

export const FullPhone: Story = {
  name: 'Повна на телефоні: ряд гортається вбік',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <HowToCard {...args} variant="full" />
    </Stage>
  ),
};

export const Compact: Story = {
  name: 'Компактна біля плеєра (−15…+10 хв): жовта смуга, 2–4 пункти',
  render: (args) => (
    <Stage>
      <StateRow label="2 пункти">
        <HowToCard {...args} variant="compact" traditions={TRADITIONS.slice(0, 2)} headingLevel="h3" />
      </StateRow>
      <StateRow label="4 пункти">
        <HowToCard {...args} variant="compact" traditions={TRADITIONS} headingLevel="h3" />
      </StateRow>
    </Stage>
  ),
};

export const Tv: Story = {
  name: 'ТВ: бічна колонка',
  globals: { surface: 'tv' },
  render: (args) => (
    <Stage>
      <div className="max-w-3xl">
        <HowToCard {...args} variant="tv" country="Велика Британія" />
      </div>
    </Stage>
  ),
};
