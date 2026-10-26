import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { EmojiPicker } from '@/components/windows/Emoji';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/Emoji',
  component: EmojiPicker,
  globals: { surface: 'phone' },
  args: { value: 'glasses', onSelect: () => undefined, seatLabel: 'Перший ряд · Лондон · місце 4' },
  render: (args) => {
    const Inner = () => {
      const [value, setValue] = useState(args.value);
      return <EmojiPicker {...args} value={value} onSelect={setValue} />;
    };
    return (
      <Stage>
        <div className="rounded-lg border border-border bg-surface p-4">
          <h2 className="pb-3 text-headline-sm">Твоя емоція на стіні</h2>
          <Inner />
        </div>
      </Stage>
    );
  },
} satisfies Meta<typeof EmojiPicker>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: 'Phone-Emoji — 16 емодзі, «Зараз на стіні»', args: { onWall: { name: 'Олена і друзі', emojiId: 'glasses' } } };

export const Desktop: Story = { name: 'Popover біля кнопки (десктоп)', globals: { surface: 'desktop' } };

export const TooOften: Story = { name: '«зачасто» — раз на 10 с', args: { waitSec: 6 } };
