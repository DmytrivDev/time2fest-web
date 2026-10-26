import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { IconButton } from '@/components/primitives/IconButton';
import { Textarea } from '@/components/primitives/Textarea';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Textarea', component: Textarea, args: { label: 'Привітання' } } satisfies Meta<typeof Textarea>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stage className="max-w-80">
      <Textarea label="Привітання" maxLength={80} counter placeholder="Напиши, що хочеш сказати світу" />
    </Stage>
  ),
};

export const AutoHeight: Story = {
  name: 'Автовисота 1–4 рядки',
  render: () => (
    <Stage className="max-w-80">
      <Textarea
        label="Привітання"
        maxLength={200}
        counter
        defaultValue={'З Новим роком!\nНехай буде мир.\nНехай збудуться мрії.\nНехай поруч будуть рідні.\nП’ятий рядок прокручується.'}
      />
    </Stage>
  ),
};

export const ChatInput: Story = {
  name: 'Поле чату: приховане підпис, кнопки справа, лічильник з 180',
  render: () => (
    <Stage className="max-w-80">
      <Textarea
        label="Повідомлення в чат «Світ»"
        hideLabel
        maxLength={200}
        counter
        counterFrom={180}
        defaultValue={'А'.repeat(196)}
        endSlot={
          <>
            <IconButton icon="smile" aria-label="Готові привітання" />
            <IconButton icon="send" aria-label="Надіслати" />
          </>
        }
      />
    </Stage>
  ),
};

export const States: Story = {
  render: () => (
    <Stage className="max-w-80">
      <Textarea label="d — звичайне" defaultValue="З Новим роком!" />
      <Textarea label="x — неактивне" defaultValue="З Новим роком!" disabled />
      <Textarea label="e — помилка" defaultValue="Привітання не пройшло модерацію" error="Привітання не пройшло модерацію — зміни текст" />
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage className="max-w-80">
      <Textarea label="Привітання" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
