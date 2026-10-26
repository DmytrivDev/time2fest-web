import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Link } from '@/components/primitives/Link';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Link',
  component: Link,
  args: { href: '#', children: 'Лондон · Біг-Бен' },
} satisfies Meta<typeof Link>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <Stage>
      <StateRow label="inline">
        <p className="text-body">
          Дивись <Link href="#">правила чату</Link> перед початком.
        </p>
      </StateRow>
      <StateRow label="chevron">
        <Link variant="chevron" href="#">Лондон · Біг-Бен</Link>
        <Link variant="chevron" href="#">Обрати трансляцію</Link>
      </StateRow>
      <StateRow label="nav (хедер) · поточна сторінка">
        <Link variant="nav" href="#" current>Головна</Link>
        <Link variant="nav" href="#">Країни</Link>
      </StateRow>
      <StateRow label="footer (рядок ≥ 44 px)">
        <div className="flex flex-col">
          <Link variant="footer" href="#">Допомога</Link>
          <Link variant="footer" href="#">Політика конфіденційності</Link>
          <Link variant="footer" href="#">Налаштування cookies</Link>
        </div>
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Link variant="chevron" href="#">Лондон · Біг-Бен</Link>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const Hover: Story = {
  render: () => (
    <Stage>
      <Link variant="nav" href="#">Країни</Link>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    const a = canvasElement.querySelector('a');
    if (a) await userEvent.hover(a);
  },
};
