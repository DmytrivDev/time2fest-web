import type { Meta, StoryObj } from '@storybook/nextjs';
import { Countdown } from '@/components/primitives/Countdown';
import { formatCountdown, formatShortCountdown } from '@/lib/i18n/time';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Countdown',
  component: Countdown,
  args: { target: '2027-01-01T00:00:00Z', label: 'до півночі' },
} satisfies Meta<typeof Countdown>;
export default meta;
type Story = StoryObj<typeof meta>;

// «Машина часу»: панель Storybook «Час» або параметр `time` (див. .storybook/preview.tsx).
const MIDNIGHT = '2027-01-01T00:00:00Z';

export const Hero: Story = {
  name: 'hero 72 / 48 (телефон)',
  parameters: { time: { at: '2026-12-31T23:37:45Z' } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="hero" label="до першої півночі планети" caption="до першої півночі планети — Кірібаті" />
    </Stage>
  ),
};

export const HeroPhone: Story = {
  name: 'hero — телефон 48',
  globals: { viewport: { value: 'phone', isRotated: false } },
  parameters: { time: { at: '2026-12-31T23:37:45Z' } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="hero" label="до першої півночі планети" caption="до першої півночі планети — Кірібаті" />
    </Stage>
  ),
};

export const Inline: Story = {
  name: 'inline 20 — «до півночі 00:22:15», «далі через 0:59»',
  parameters: { time: { at: '2026-12-31T23:37:45Z' } },
  render: () => (
    <Stage>
      <StateRow label="inline hms">
        <span className="inline-flex items-baseline gap-2 text-body text-text-secondary">
          до півночі <Countdown target={MIDNIGHT} variant="inline" label="до півночі" />
        </span>
      </StateRow>
      <StateRow label="inline ms (остання хвилина)">
        <span className="inline-flex items-baseline gap-2 text-body text-text-secondary">
          далі через <Countdown target="2026-12-31T23:38:44Z" variant="inline" format="ms" label="до наступної події" />
        </span>
      </StateRow>
    </Stage>
  ),
};

export const Tv: Story = {
  name: 'tv 88',
  globals: { surface: 'tv' },
  parameters: { time: { at: '2026-12-31T22:57:12Z' } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="tv" label="до Нового року · Київ" caption="до Нового року · Київ" />
    </Stage>
  ),
};

export const Days: Story = {
  name: 'Багато днів (передсвятковий стан)',
  parameters: { time: { at: '2026-12-01T10:00:00Z', frozen: true } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="hero" label="до першої півночі планети" />
    </Stage>
  ),
};

export const RunningToZero: Story = {
  name: 'Тікає і досягає нуля (−20 с → 00:00)',
  parameters: { time: { at: '2026-12-31T23:59:40Z' } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="hero" label="до півночі" caption="Відео може запізнюватися на кілька секунд" />
    </Stage>
  ),
};

export const AtZero: Story = {
  name: 'На нулі',
  parameters: { time: { at: MIDNIGHT, frozen: true } },
  render: () => (
    <Stage>
      <Countdown target={MIDNIGHT} variant="hero" label="до півночі" />
    </Stage>
  ),
};

export const Format: Story = {
  name: 'Формат: табличні цифри, ширина не стрибає',
  render: () => (
    <Stage>
      <p className="text-countdown-inline tabular-nums text-text">
        {formatCountdown(22 * 60_000 + 15_000)} · {formatShortCountdown(59_000)} · {formatCountdown(11 * 60_000 + 11_000)}
      </p>
    </Stage>
  ),
};
