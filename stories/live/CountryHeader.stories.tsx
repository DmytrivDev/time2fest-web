import type { Meta, StoryObj } from '@storybook/nextjs';
import { CountryHeader } from '@/components/live/CountryHeader';
import { Stage, StateRow } from '../_support/Stage';

const FRANCE = { iso: 'FR', name: { uk: 'Франція' }, flagCode: 'FR', gender: 'f' } as const;
// Північ 01:00 за київським часом; пояс глядача зафіксовано, щоб історія не залежала від браузера.
const MIDNIGHT = Date.UTC(2026, 11, 31, 23, 0, 0);
const TZ = 'Europe/Kyiv';
const RUSSIA_ZONES = [
  { id: 'z1', label: 'UTC+2 · Калінінград' },
  { id: 'z2', label: 'UTC+3 · Москва' },
  { id: 'z3', label: 'UTC+5 · Єкатеринбург' },
];

const meta = {
  title: 'Живий ефір/CountryHeader',
  component: CountryHeader,
  args: { country: FRANCE, midnightMs: MIDNIGHT, after: false, timeZone: TZ },
} satisfies Meta<typeof CountryHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const DesktopBefore: Story = {
  name: 'Десктоп: до півночі',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <CountryHeader {...args} />
    </Stage>
  ),
};

export const DesktopAfter: Story = {
  name: 'Десктоп: після півночі («зустріла Новий рік»)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <CountryHeader {...args} after />
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон: рядок «Країни › Франція» і календар',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <StateRow label="до півночі">
        <CountryHeader {...args} className="w-full" />
      </StateRow>
      <StateRow label="після півночі">
        <CountryHeader {...args} after className="w-full" />
      </StateRow>
    </Stage>
  ),
};

export const MultiZone: Story = {
  name: 'Кілька поясів: чипи',
  globals: { surface: 'desktop' },
  args: { country: { iso: 'RU', name: { uk: 'Росія' }, flagCode: 'RU', gender: 'f' }, zones: RUSSIA_ZONES, selectedZoneId: 'z2' },
  render: (args) => (
    <Stage>
      <CountryHeader {...args} />
    </Stage>
  ),
};
