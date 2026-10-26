import type { Meta, StoryObj } from '@storybook/nextjs';
import { Skeleton } from '@/components/primitives/Skeleton';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Skeleton', component: Skeleton } satisfies Meta<typeof Skeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <Stage className="max-w-xl">
      <StateRow label="block · line · circle">
        <Skeleton variant="block" className="w-40" />
        <div className="flex w-48 flex-col gap-2">
          <Skeleton variant="line" />
          <Skeleton variant="line" className="w-2/3" />
        </div>
        <Skeleton variant="circle" />
      </StateRow>
      <StateRow label="chat-line">
        <div className="flex w-full flex-col gap-4">
          <Skeleton variant="chat-line" />
          <Skeleton variant="chat-line" />
        </div>
      </StateRow>
    </Stage>
  ),
};

export const Player: Story = {
  name: 'player — 16:9, не нижче 200 px',
  globals: { surface: 'phone' },
  render: () => (
    <div aria-busy="true">
      <Skeleton variant="player" />
      <p className="p-4 text-body text-text-muted">Завантажуємо трансляцію</p>
    </div>
  ),
};

export const ReducedMotion: Story = {
  name: 'Без відблиску під «зменшити рух»',
  globals: { reduceMotion: 'on' },
  render: () => (
    <Stage className="max-w-xl">
      <Skeleton variant="block" />
    </Stage>
  ),
};
