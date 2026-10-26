import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { RadioGroup, type RadioOption } from '@/components/primitives/RadioGroup';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/RadioGroup',
  component: RadioGroup,
  args: { label: 'Мова сайту', options: [] },
} satisfies Meta<typeof RadioGroup>;
export default meta;
type Story = StoryObj<typeof meta>;

const LANGS: RadioOption[] = [
  { value: 'uk', label: 'Українська', lang: 'uk' },
  { value: 'en', label: 'English', lang: 'en' },
  { value: 'es', label: 'Español', lang: 'es' },
  { value: 'fr', label: 'Français', lang: 'fr' },
];
const EMOJI: RadioOption[] = [
  { value: 'glasses', label: 'Келихи', symbol: '🥂' },
  { value: 'heart', label: 'Серце', symbol: '❤️' },
  { value: 'fireworks', label: 'Феєрверк', symbol: '🎆' },
  { value: 'star', label: 'Зірка', symbol: '⭐' },
  { value: 'tree', label: 'Ялинка', symbol: '🎄' },
  { value: 'confetti', label: 'Конфеті', symbol: '🎉' },
  { value: 'gift', label: 'Подарунок', symbol: '🎁' },
  { value: 'smile', label: 'Усмішка', symbol: '😊' },
];
const STARS: RadioOption[] = [1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: `${n} з 5` }));

export const List: Story = {
  name: 'list — мови (lang на пунктах, без прапорів)',
  render: () => (
    <Stage className="max-w-80">
      <StateRow label="d · s (вибрана)">
        <RadioGroup label="Мова сайту" options={LANGS} defaultValue="uk" className="w-full" />
      </StateRow>
      <StateRow label="x — неактивна група">
        <RadioGroup label="Мова сайту" options={LANGS} defaultValue="en" disabled className="w-full" />
      </StateRow>
    </Stage>
  ),
};

export const Grid: Story = {
  name: 'grid — емодзі 44×44 (назви, не символи, у доступних назвах)',
  render: () => (
    <Stage className="max-w-80">
      <RadioGroup variant="grid" label="Твоя емоція" options={EMOJI} defaultValue="glasses" />
    </Stage>
  ),
};

export const Stars: Story = {
  name: 'stars — 5 × 44 px',
  render: () => (
    <Stage>
      <StateRow label="не вибрано · 3 з 5">
        <RadioGroup variant="stars" label="Оцінка шоу" options={STARS} />
        <RadioGroup variant="stars" label="Оцінка шоу" options={STARS} defaultValue="3" />
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage className="max-w-80">
      <RadioGroup label="Мова сайту" options={LANGS} defaultValue="uk" className="w-full" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
