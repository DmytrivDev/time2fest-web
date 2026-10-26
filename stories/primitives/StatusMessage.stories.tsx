import type { Meta, StoryObj } from '@storybook/nextjs';
import { Button } from '@/components/primitives/Button';
import { Link } from '@/components/primitives/Link';
import { StatusMessage } from '@/components/primitives/StatusMessage';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/StatusMessage', component: StatusMessage, args: { children: 'Додано в графік' } } satisfies Meta<typeof StatusMessage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Kinds: Story = {
  render: () => (
    <Stage className="max-w-xl">
      <StatusMessage kind="info">Перемкнули на іншу трансляцію з цього місця</StatusMessage>
      <StatusMessage kind="success">Додано в графік</StatusMessage>
      <StatusMessage kind="offline">Немає з’єднання · Відлік іде далі. Відео й чат повернуться самі</StatusMessage>
      <StatusMessage kind="error">Не вдалося зберегти</StatusMessage>
    </Stage>
  ),
};

export const WithAction: Story = {
  name: 'З дією',
  render: () => (
    <Stage className="max-w-xl">
      <StatusMessage kind="error" action={<Button variant="secondary">Спробувати ще</Button>}>
        Збережемо самі, щойно з’явиться зв’язок
      </StatusMessage>
      <StatusMessage kind="info" action={<Link variant="chevron" href="#">Перейти</Link>}>
        Велика Британія зустріла Новий рік
      </StatusMessage>
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон 390 — перенесення тексту й дії',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <StatusMessage kind="offline" action={<Button variant="secondary">Спробувати ще</Button>}>
        Немає з’єднання · Відлік іде далі. Відео й чат повернуться самі
      </StatusMessage>
    </Stage>
  ),
};
