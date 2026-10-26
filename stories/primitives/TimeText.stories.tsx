import type { Meta, StoryObj } from '@storybook/nextjs';
import { TimeText } from '@/components/primitives/TimeText';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/TimeText',
  component: TimeText,
  args: { at: '2027-01-01T01:00:00Z', timeZone: 'Europe/Kyiv' },
  parameters: { time: { at: '2026-12-31T22:00:00Z', frozen: true } },
} satisfies Meta<typeof TimeText>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Card: Story = {
  name: 'card — «03:00» 28 px + «за вашим часом»',
  render: () => (
    <Stage>
      <TimeText at="2027-01-01T01:00:00Z" timeZone="Europe/Kyiv" variant="card" />
    </Stage>
  ),
};

export const Inline: Story = {
  name: 'inline — дата, якщо інший день; 12/24 год',
  render: () => (
    <Stage>
      <StateRow label="той самий день · інший день · 12 год">
        <TimeText at="2026-12-31T23:30:00Z" timeZone="Europe/Kyiv" />
        <TimeText at="2027-01-01T05:00:00Z" timeZone="Europe/Kyiv" />
        <TimeText at="2027-01-01T01:00:00Z" timeZone="America/New_York" locale="en-US" />
      </StateRow>
    </Stage>
  ),
};

export const Relative: Story = {
  name: 'relative — «північ була 38 хв тому»',
  parameters: { time: { at: '2027-01-01T00:38:00Z', frozen: true } },
  render: () => (
    <Stage>
      <StateRow label="минуле · майбутнє">
        <TimeText at="2027-01-01T00:00:00Z" variant="relative" midnight />
        <TimeText at="2027-01-01T02:00:00Z" variant="relative" />
      </StateRow>
    </Stage>
  ),
};

export const UtcHint: Story = {
  name: 'UTC лише в підказці',
  render: () => (
    <Stage className="pt-16">
      <TimeText at="2027-01-01T01:00:00Z" timeZone="Europe/Kyiv" utcHint />
    </Stage>
  ),
};
