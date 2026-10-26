import type { Meta, StoryObj } from '@storybook/nextjs';
import { FestProgress } from '@/components/live/Progress';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Живий ефір/FestProgress',
  component: FestProgress,
  args: { hoursPassed: 13, hoursTotal: 26, zonesDone: 23, zonesTotal: 38, startLabel: '12:00 · Кірибаті', endLabel: '14:00 · 1 січня' },
} satisfies Meta<typeof FestProgress>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: (args) => (
    <Stage>
      <StateRow label="початок · середина · кінець">
        <div className="w-full max-w-md">
          <FestProgress {...args} hoursPassed={0} zonesDone={0} />
        </div>
        <div className="w-full max-w-md">
          <FestProgress {...args} />
        </div>
        <div className="w-full max-w-md">
          <FestProgress {...args} hoursPassed={26} zonesDone={38} />
        </div>
      </StateRow>
    </Stage>
  ),
};
