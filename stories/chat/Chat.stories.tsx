import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { useEffect, useState, type ComponentProps } from 'react';
import { Chat } from '@/components/chat/Chat';
import { Message } from '@/components/chat/Message';
import type { ChatMessage } from '@/lib/data/types';
import { Stage, StateRow } from '../_support/Stage';
import {
  AMIRA,
  CHAT_SAMPLE,
  GREETING,
  JAMES,
  LIAM,
  LOOKUP,
  ME,
  SYSTEM_COUNTER,
  SYSTEM_FIRSTROW,
  SYSTEM_MIDNIGHT,
  SYSTEM_POLL,
  SYSTEM_SINGLE,
  SYSTEM_SLOW,
  regular,
} from '../us1/fixtures';

const meta = {
  title: 'Чат/Chat',
  component: Chat,
  globals: { surface: 'phone' },
  args: { room: { id: 'world', label: 'Світ' }, messages: CHAT_SAMPLE, lookup: LOOKUP },
  decorators: [
    (Story) => (
      <>
        <Stage>
          <div className="flex h-120 min-h-0 flex-col overflow-hidden rounded-lg border border-border">
            <Story />
          </div>
        </Stage>
      </>
    ),
  ],
} satisfies Meta<typeof Chat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = { name: 'live — Phone-Chat, Main (кімната «Світ»)' };

export const Loading: Story = { name: 'l — скелетони', args: { state: 'l' } };

export const EmptyCountry: Story = {
  name: 'empty — «Тут поки тихо — привітай першим»',
  args: { room: { id: 'country:FR', label: 'Франція' }, messages: [] },
};

export const EmptyFirstRow: Story = {
  name: 'empty-first-row',
  args: { room: { id: 'firstrow:evt_london_2027', label: 'Перший ряд' }, messages: [] },
};

export const Unavailable: Story = {
  name: 'unavailable — Phone-Chat-Unavailable',
  args: { state: 'unavailable', onToEvents: () => undefined },
};

export const Paused: Story = {
  name: 'paused — Phone-Chat-Paused («Пауза чату» натиснуто)',
  args: { defaultPaused: true },
};

export const WithHide: Story = {
  name: 'з кнопкою «Сховати чат»',
  args: { onHide: () => undefined },
};

const POOL: ChatMessage[] = [
  regular(LIAM, 'Sydney says hi again! 🎆'),
  regular(AMIRA, 'Привіт з Торонто!'),
  regular(JAMES, 'The Thames is packed!'),
  regular(ME, 'Вітаю з Києва!'),
];

function Streaming(args: ComponentProps<typeof Chat>) {
  const [messages, setMessages] = useState<ChatMessage[]>(args.messages as ChatMessage[]);
  useEffect(() => {
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      const base = POOL[i % POOL.length]!;
      setMessages((m) => [...m, { ...base, id: `s${i}`, createdAt: base.createdAt + i * 1000 }]);
    }, 1500);
    return () => window.clearInterval(id);
  }, []);
  return <Chat {...args} messages={messages} />;
}

export const Streams: Story = {
  name: 'нові повідомлення йдуть; прокрутка вгору зупиняє стрічку',
  render: (args) => <Streaming {...args} />,
};

export const KeyboardRoving: Story = {
  name: 'клавіатура: один Tab-стоп, стрілки між авторами',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    const stops = canvas.getAllByRole('button').filter((b) => b.hasAttribute('data-chat-author') && b.tabIndex === 0);
    await expect(stops).toHaveLength(1);
    await userEvent.keyboard('{ArrowUp}');
    await expect(document.activeElement).toHaveAttribute('data-chat-author');
  },
};

export const Messages: Story = {
  name: 'Message — усі варіанти',
  decorators: [
    (Story) => (
      <>
        <Story />
      </>
    ),
  ],
  render: () => (
    <Stage>
      <StateRow label="regular · пас · перший ряд з емоцією · це ти · відповідь · без довідника країн">
        <ol className="flex w-full flex-col gap-2">
          <Message message={CHAT_SAMPLE[0]!} lookup={LOOKUP} />
          <Message message={CHAT_SAMPLE[2]!} lookup={LOOKUP} />
          <Message message={CHAT_SAMPLE[3]!} lookup={LOOKUP} />
          <Message message={CHAT_SAMPLE[6]!} lookup={LOOKUP} />
          <Message message={CHAT_SAMPLE[8]!} lookup={LOOKUP} />
          <Message message={regular(LIAM, 'Без довідника країн')} />
        </ol>
      </StateRow>
      <StateRow label="system — «Time2Fest вітає…» зі знаком">
        <ol className="flex w-full flex-col gap-2">
          <Message message={SYSTEM_SINGLE} lookup={LOOKUP} />
          <Message message={SYSTEM_MIDNIGHT} lookup={LOOKUP} />
          <Message message={SYSTEM_FIRSTROW} lookup={LOOKUP} />
          <Message message={SYSTEM_COUNTER} lookup={LOOKUP} />
          <Message message={SYSTEM_SLOW} lookup={LOOKUP} />
          <Message message={SYSTEM_POLL} lookup={LOOKUP} />
        </ol>
      </StateRow>
      <StateRow label="greeting — картка з жовтою межею ліворуч">
        <ol className="flex w-full flex-col gap-2">
          <Message message={GREETING} lookup={LOOKUP} />
        </ol>
      </StateRow>
      <StateRow label="moderated — лише автору">
        <ol className="flex w-full flex-col gap-2">
          <Message message={regular(ME, 'x', 0, { moderation: 'hidden' })} lookup={LOOKUP} />
        </ol>
      </StateRow>
    </Stage>
  ),
};
