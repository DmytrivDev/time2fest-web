import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Switch } from '@/components/primitives/Switch';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Switch', component: Switch, args: { label: 'Лише з трансляціями' } } satisfies Meta<typeof Switch>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: () => (
    <Stage>
      <StateRow label="d — вимкнений · s — увімкнений · x — неактивні">
        <Switch label="Лише з трансляціями" />
        <Switch label="Лише з трансляціями" defaultChecked />
        <Switch label="Тихий режим" disabled />
        <Switch label="Тихий режим" disabled defaultChecked />
      </StateRow>
    </Stage>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stage>
      <StateRow label="підпис ліворуч (типово) · праворуч · компактний (шапка чату, футер)">
        <Switch label="Показувати без трансляції" />
        <Switch label="Показувати без трансляції" labelSide="end" />
        <Switch label="Зменшити рух" compact />
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Switch label="Зменшити рух" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
