import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent, within } from 'storybook/test';
import { Button, type ButtonVariant } from '@/components/primitives/Button';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Button',
  component: Button,
  args: { children: 'Увімкнути звук', variant: 'coral', size: 'md' },
  argTypes: {
    variant: { control: 'select', options: ['coral', 'secondary', 'tonal', 'ghost'] },
    size: { control: 'inline-radio', options: ['md', 'lg', 'tv'] },
  },
} satisfies Meta<typeof Button>;
export default meta;
type Story = StoryObj<typeof meta>;

const VARIANTS: ButtonVariant[] = ['coral', 'secondary', 'tonal', 'ghost'];

export const Playground: Story = {
  render: (args) => (
    <Stage>
      <Button {...args} />
    </Stage>
  ),
};

export const Variants: Story = {
  render: () => (
    <Stage>
      <StateRow label="d — звичайні: coral (одна на екран), secondary, tonal, ghost">
        {VARIANTS.map((v) => (
          <Button key={v} variant={v}>
            {v === 'coral' ? 'Увімкнути звук' : v === 'tonal' ? 'Кімната перегляду' : v === 'ghost' ? 'Детальніше' : 'Обрати трансляцію'}
          </Button>
        ))}
      </StateRow>
    </Stage>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stage>
      <StateRow label="md 44 · lg 48 (дія у формі, аркуші, вікні) · tv 56">
        <Button variant="secondary" size="md">Скасувати</Button>
        <Button variant="coral" size="lg">Оплатити</Button>
        <Button variant="tonal" size="tv">Режим вечірки</Button>
      </StateRow>
    </Stage>
  ),
};

export const WithIcons: Story = {
  render: () => (
    <Stage>
      <StateRow label="іконка зліва / справа (stroke 1.8)">
        <Button variant="coral" iconLeft="speaker">Увімкнути звук</Button>
        <Button variant="secondary" iconLeft="calendar-add">Додати в графік</Button>
        <Button variant="tonal" iconRight="chevron-right">Обрати трансляцію</Button>
        <Button variant="secondary" iconRight="chevron-down">Ще дії</Button>
      </StateRow>
    </Stage>
  ),
};

export const States: Story = {
  render: () => (
    <Stage>
      {VARIANTS.map((v) => (
        <StateRow key={v} label={`${v}: d · x (неактивна) · l (завантаження) · o (розгорнута)`}>
          <Button variant={v}>Дія</Button>
          <Button variant={v} disabled>Дія</Button>
          <Button variant={v} loading>Дія</Button>
          <Button variant={v} aria-expanded="true" iconRight="chevron-up">Дія</Button>
        </StateRow>
      ))}
    </Stage>
  ),
};

export const Hover: Story = {
  render: () => (
    <Stage>
      <Button variant="secondary">Кімната перегляду</Button>
    </Stage>
  ),
  play: async ({ canvasElement }) => {
    await userEvent.hover(within(canvasElement).getByRole('button'));
  },
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Button variant="coral">Увімкнути звук</Button>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const FocusOnTv: Story = {
  name: 'Focus · ТВ (4 px)',
  globals: { surface: 'tv' },
  render: () => (
    <Stage>
      <Button variant="tonal" size="tv">Режим вечірки</Button>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const AsChildLink: Story = {
  render: () => (
    <Stage>
      <Button variant="secondary" asChild>
        <a href="#country">Обрати трансляцію ›</a>
      </Button>
    </Stage>
  ),
};

export const LongTextNoFixedWidth: Story = {
  name: 'Довгий текст (es/fr +30%)',
  render: () => (
    <Stage className="max-w-60">
      <Button variant="secondary" className="whitespace-normal">Choisir la retransmission de la fête</Button>
    </Stage>
  ),
};
