import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Logo } from '@/components/primitives/Logo';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Logo', component: Logo, args: { label: 'Time2Fest — на головну' } } satisfies Meta<typeof Logo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <Stage>
      <StateRow label="header 112×32">
        <Logo label="Time2Fest — на головну" />
      </StateRow>
      <StateRow label="tv (верх бічної колонки)">
        <Logo variant="tv" label="Time2Fest — на головну" />
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Logo label="Time2Fest — на головну" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
