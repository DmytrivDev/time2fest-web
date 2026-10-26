import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { IconButton } from '@/components/primitives/IconButton';
import { Tooltip } from '@/components/primitives/Tooltip';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Tooltip',
  component: Tooltip,
  args: { content: 'Додати в кімнату перегляду', children: <span /> },
} satisfies Meta<typeof Tooltip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  name: 'd — закрита',
  render: () => (
    <Stage className="pt-16">
      <Tooltip content="Додати в кімнату перегляду">
        <IconButton icon="plus" variant="ring" aria-label="Додати в кімнату" />
      </Tooltip>
    </Stage>
  ),
};

export const Open: Story = {
  name: 'o — відкрита (не зникає сама, Esc закриває)',
  render: () => (
    <Stage className="pt-16">
      <Tooltip content="Додати в кімнату перегляду" defaultOpen>
        <IconButton icon="plus" variant="ring" aria-label="Додати в кімнату" />
      </Tooltip>
    </Stage>
  ),
};

export const OnFocus: Story = {
  name: 'Показ на фокусі клавіатури',
  render: () => (
    <Stage className="pt-16">
      <Tooltip content="Додати в кімнату перегляду">
        <IconButton icon="plus" variant="ring" aria-label="Додати в кімнату" />
      </Tooltip>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
