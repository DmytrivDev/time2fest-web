import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { Composer, type ComposerProps } from '@/components/chat/Composer';
import { Stage } from '../_support/Stage';


function Stateful(args: ComposerProps) {
  const [value, setValue] = useState(args.value);
  return <Composer {...args} value={value} onValueChange={setValue} />;
}

const meta = {
  title: 'Чат/Composer',
  component: Composer,
  globals: { surface: 'phone' },
  args: {
    room: { id: 'world', label: 'Світ' },
    value: '',
    onValueChange: () => undefined,
    onSubmit: () => undefined,
  },
  render: (args) => (
    <Stage>
      <div className="rounded-lg border border-border">
        <Stateful {...args} />
      </div>
    </Stage>
  ),
} satisfies Meta<typeof Composer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = { name: 'порожнє — поле, «Готові привітання», «Надіслати»' };

export const Typing: Story = { name: 'typing — лічильника ще немає (до 180)', args: { value: 'Привіт з Києва! Тут уже майже 2027.' } };

export const Counter: Story = {
  name: 'counter — 184/200, за 5 до межі колір text',
  args: { value: 'а'.repeat(184) },
};

export const Limit: Story = {
  name: 'на 200 — кораловий «Досить»',
  args: { value: 'а'.repeat(200) },
};

export const LinkError: Story = {
  name: 'link-error — Phone-Chat-Slow: текст лишається',
  args: { value: 'Дивіться також www.example.com/thames-live', error: 'link' },
};

export const Slow: Story = {
  name: 'slow — Phone-Chat-Slow: «Надіслати — зачекай 8 секунд»',
  args: { value: 'Привіт усім!', slowRemaining: 8, slowTotal: 15 },
};

export const SlowOn: Story = { name: 'повільний режим діє, але можна писати', args: { slowTotal: 15 } };

export const Banned: Story = { name: 'banned — поле неактивне з причиною', args: { banned: true } };

export const Offline: Story = { name: 'offline — «Поле неактивне, поки немає з’єднання»', args: { offline: true } };

export const Reply: Story = {
  name: 'відповідь — цитата з «Скасувати відповідь» (Phone-Chat-Actions)',
  args: { reply: { nick: 'Аміра', excerpt: 'Привіт з Торонто! Тут ще 18:38 🙂' }, onCancelReply: () => undefined },
};

export const Greetings: Story = {
  name: 'Готові привітання — Popover (Phone-Chat-Greetings)',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Готові привітання' }));
    await expect(await within(document.body).findByRole('button', { name: /З Новим роком!/ })).toBeInTheDocument();
  },
};
