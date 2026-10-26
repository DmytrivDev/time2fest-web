import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Checkbox } from '@/components/primitives/Checkbox';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Checkbox', component: Checkbox, args: { label: 'Наживо', count: 19 } } satisfies Meta<typeof Checkbox>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <Stage className="max-w-80">
      <StateRow label="d · s · x (рядок з лічильником)">
        <div className="flex w-full flex-col">
          <Checkbox label="Наживо" count={19} />
          <Checkbox label="Очікується" count={7} defaultChecked />
          <Checkbox label="Лише відлік" count={4} disabled />
        </div>
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage className="max-w-80">
      <Checkbox label="Наживо" count={19} />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
