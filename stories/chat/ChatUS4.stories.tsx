import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Chat } from '@/components/chat/Chat';
import { ChatHiddenButton } from '@/components/chat/parts/ChatHiddenButton';
import { Composer } from '@/components/chat/parts/Composer';
import { ReactionsRow } from '@/components/chat/parts/MessageActions';
import { Message } from '@/components/chat/parts/Message';
import { useChatFeed } from '@/lib/chat-sim/store';
import type { ChatMessage } from '@/lib/data/types';
import { useChatUi } from '@/stores/chat';
import { Stage, StateRow } from '../_support/Stage';
import { AMIRA, CHAT_SAMPLE, JAMES, LIAM, LOOKUP, ME, regular } from '../us1/fixtures';

const withReactions: ChatMessage = {
  ...regular(AMIRA, 'Привіт з Торонто! Тут ще 18:38 🙂', 3),
  reactions: { clap: { count: 12, mine: true }, heart: { count: 4, mine: false } },
};
const mention: ChatMessage = regular(LIAM, '@Мирон бачиш Сідней?', 4);
const reply: ChatMessage = regular(ME, 'Дякую!', 5, { replyTo: { id: 'x', nick: 'Аміра', excerpt: 'Привіт з Торонто!' } });
const handlers = { onReact: () => undefined, onReply: () => undefined, onReport: () => undefined };

const noop = () => undefined;
const composer = (over: Partial<React.ComponentProps<typeof Composer>> = {}) => (
  <Composer room={{ id: 'world', label: 'Світ' }} value="" onValueChange={noop} onSubmit={noop} {...over} />
);

const meta = {
  title: 'Чат/Чат повністю (US4)',
  component: Chat,
  globals: { surface: 'phone' },
  args: { room: { id: 'world', label: 'Світ' }, messages: CHAT_SAMPLE, lookup: LOOKUP, onHide: noop, onRules: noop },
  decorators: [
    (Story) => (
      <Stage>
        <div className="flex h-120 min-h-0 flex-col overflow-hidden rounded-lg border border-border">
          <Story />
        </div>
      </Stage>
    ),
  ],
} satisfies Meta<typeof Chat>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = { name: 'Phone-Chat — стрічка, поле, «Ще дії чату»', args: { composer: composer() } };

export const Paused: Story = {
  name: 'Phone-Chat-Paused — «Нові повідомлення N ↓»',
  args: { defaultPaused: true, composer: composer() },
  render: (args) => {
    const Inner = () => {
      const [messages, setMessages] = useState<ChatMessage[]>(args.messages as ChatMessage[]);
      return (
        <>
          <Chat {...args} messages={messages} />
          <button
            type="button"
            className="border-t border-border p-2 text-caption text-text-muted"
            onClick={() => setMessages((m) => [...m, regular(JAMES, `Нове ${m.length}`, m.length)])}
          >
            + повідомлення
          </button>
        </>
      );
    };
    return <Inner />;
  },
};

export const Slow: Story = {
  name: 'Phone-Chat-Slow — повільний режим, лічильник, посилання',
  args: {
    composer: composer({ value: 'а'.repeat(184) + ' www.example.com', slowRemaining: 8, slowTotal: 15, error: 'link' }),
  },
};

export const Offline: Story = {
  name: 'offline — «Немає з’єднання», поле неактивне',
  args: { banner: <p className="border-b border-border px-3.5 py-2 text-caption text-text-secondary">Немає з’єднання — чат повернеться, щойно воно з’явиться</p>, composer: composer({ offline: true }) },
};

export const EmptyWithGreetings: Story = {
  name: 'Phone-Country-Chat — порожньо, готові привітання поруч',
  args: { room: { id: 'country:FR', label: 'Франція' }, messages: [], composer: composer({ room: { id: 'country:FR', label: 'Франція' } }) },
};

export const Unavailable: Story = {
  name: 'Phone-Chat-Unavailable — відео й «Події» працюють',
  args: { state: 'unavailable', onToEvents: noop },
};

export const Actions: Story = {
  name: 'Phone-Chat-Actions — реакції, згадка, відповідь (меню «⋯» — у Chat)',
  render: () => (
    <Stage>
      <StateRow label="реакції під текстом, згадка, відповідь">
        <ol className="flex w-full flex-col gap-2">
          <Message message={withReactions} lookup={LOOKUP} onOpenMenu={noop} {...handlers} />
          <Message message={mention} lookup={LOOKUP} onOpenMenu={noop} {...handlers} />
          <Message message={reply} lookup={LOOKUP} onOpenMenu={noop} {...handlers} />
        </ol>
      </StateRow>
      <StateRow label="ReactionsRow окремо">
        <ReactionsRow message={withReactions} onReact={noop} />
      </StateRow>
    </Stage>
  ),
};

export const Hidden: Story = {
  name: 'Phone-Chat-Hidden / Desk-Chat-Hidden-Input — «Показати чат 99+»',
  render: () => {
    useChatUi.getState().markHidden(0);
    useChatFeed.getState().append(Array.from({ length: 120 }, (_, i) => ({ ...regular(LIAM, `m${i}`, 0), id: `h${i}`, createdAt: 1 + i })));
    return (
      <Stage>
        <StateRow label="десктоп">
          <ChatHiddenButton room="world" onShow={noop} />
        </StateRow>
      </Stage>
    );
  },
};
