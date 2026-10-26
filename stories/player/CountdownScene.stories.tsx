import type { Meta, StoryObj } from '@storybook/nextjs';
import { CountdownScene } from '@/components/player/CountdownScene';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { Stage, StateRow } from '../_support/Stage';
import { countryOf } from '../us1/fixtures';

/** Нуук: півночі 2027 о 02:00 UTC (зсув −2 год). «Зараз» — 20:37 UTC, тож місцевий час 18:37. */
const NOW = '2026-12-31T20:37:00Z';
const NUUK_MIDNIGHT = Date.parse('2027-01-01T02:00:00Z');
const PARIS_MIDNIGHT = Date.parse('2026-12-31T23:00:00Z');

const meta = {
  title: 'Плеєр/CountdownScene',
  component: CountdownScene,
  parameters: { time: { at: NOW, frozen: true } },
  args: { country: countryOf('GL'), cityName: 'Нуук', midnightMs: NUUK_MIDNIGHT, offsetMinutes: -120 },
} satisfies Meta<typeof CountdownScene>;
export default meta;
type Story = StoryObj<typeof meta>;

export const NoStreamPhone: Story = {
  name: 'Phone-Home-NoStream — трансляції немає (телефон, 390)',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <PlayerSlot fallback={<CountdownScene {...args} />} />
    </Stage>
  ),
};

export const NoStreamDesktop: Story = {
  name: 'Desk-Home-NoStream — три традиції (десктоп)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <div className="mx-auto w-full max-w-3xl">
        <PlayerSlot fallback={<CountdownScene {...args} />} />
      </div>
    </Stage>
  ),
};

export const ExpectedPhone: Story = {
  name: 'Phone-Country-Expected — «Трансляція почнеться сама»',
  globals: { surface: 'phone' },
  args: { country: countryOf('FR'), cityName: 'Ейфелева вежа', midnightMs: PARIS_MIDNIGHT, offsetMinutes: 60, variant: 'expected' },
  render: (args) => (
    <Stage>
      <PlayerSlot fallback={<CountdownScene {...args} />} />
    </Stage>
  ),
};

export const ExpectedDesktop: Story = {
  name: 'expected — десктоп',
  globals: { surface: 'desktop' },
  args: { country: countryOf('FR'), cityName: 'Ейфелева вежа', midnightMs: PARIS_MIDNIGHT, offsetMinutes: 60, variant: 'expected' },
  render: (args) => (
    <Stage>
      <div className="mx-auto w-full max-w-3xl">
        <PlayerSlot fallback={<CountdownScene {...args} />} />
      </div>
    </Stage>
  ),
};

export const Postcards: Story = {
  name: 'Листівки: власні (GB, AU, FR) і шаблон',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <StateRow label="gb-postcard · au-postcard · fr-postcard · шаблон (Нуук)">
        {(['GB', 'AU', 'FR', 'GL'] as const).map((iso) => (
          <div key={iso} className="w-80">
            <PlayerSlot fallback={<CountdownScene {...args} country={countryOf(iso)} cityName={countryOf(iso).name.uk} />} />
          </div>
        ))}
      </StateRow>
    </Stage>
  ),
};
