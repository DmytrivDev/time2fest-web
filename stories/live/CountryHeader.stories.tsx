import type { Meta, StoryObj } from '@storybook/nextjs';
import { CountryHeader } from '@/components/live/CountryHeader';
import { Stage, StateRow } from '../_support/Stage';

const FRANCE = { iso: 'FR', name: { uk: 'Франція' }, flagCode: 'FR', gender: 'f' } as const;
// Північ 01:00 за київським часом; пояс глядача зафіксовано, щоб історія не залежала від браузера.
const MIDNIGHT = Date.UTC(2026, 11, 31, 23, 0, 0);
const TZ = 'Europe/Kyiv';
const RUSSIA_ZONES = [
  { id: 'z1', utc: 'UTC+2', city: 'Калінінград', midnightMs: Date.parse('2026-12-31T22:00:00Z'), note: 'лише відлік' },
  { id: 'z2', utc: 'UTC+3', city: 'Москва', midnightMs: Date.parse('2026-12-31T21:00:00Z'), note: '1 трансляція' },
  { id: 'z3', utc: 'UTC+5', city: 'Єкатеринбург', midnightMs: Date.parse('2026-12-31T19:00:00Z'), note: 'лише відлік' },
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
  name: 'Кілька поясів: вибір поясу',
  globals: { surface: 'desktop' },
  args: { country: { iso: 'RU', name: { uk: 'Росія' }, flagCode: 'RU', gender: 'f' }, zones: RUSSIA_ZONES, selectedZoneId: 'z2' },
  render: (args) => (
    <Stage>
      <CountryHeader {...args} />
    </Stage>
  ),
};
