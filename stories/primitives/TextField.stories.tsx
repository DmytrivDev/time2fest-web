import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { TextField } from '@/components/primitives/TextField';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Примітиви/TextField',
  component: TextField,
  args: { label: 'Нік' },
} satisfies Meta<typeof TextField>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stage className="max-w-80">
      <TextField label="Нік" hint="2–20 символів, без посилань" maxLength={20} counter defaultValue="Аміра" />
    </Stage>
  ),
};

export const Types: Story = {
  render: () => (
    <Stage className="max-w-80">
      <TextField label="Нік" type="text" maxLength={20} counter defaultValue="Олена" />
      <TextField label="Email" type="email" placeholder="you@example.com" requiredMark="(обов’язково)" />
      <TextField label="Знайти прапор" type="search" defaultValue="Фра" />
    </Stage>
  ),
};

export const States: Story = {
  render: () => (
    <Stage className="max-w-80">
      <TextField label="d — звичайне" defaultValue="Аміра" />
      <TextField label="x — неактивне" defaultValue="Аміра" disabled />
      <TextField label="e — помилка" defaultValue="Аміра" error="Цей нік уже зайнято" />
      <TextField label="Email" type="email" defaultValue="пошта" error="Перевір адресу email" />
      <TextField label="Лічильник біля межі" maxLength={20} counter defaultValue="Дуже довгий нік 16" />
      <TextField label="Лічильник на межі" maxLength={20} counter defaultValue="Дуже довгий нік 1234" />
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage className="max-w-80">
      <TextField label="Нік" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
