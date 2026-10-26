import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import { Chip, ChipGroup } from '@/components/primitives/Chip';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Chip',
  component: Chip,
  args: { variant: 'country', flag: 'FR', children: 'Франція' },
} satisfies Meta<typeof Chip>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Country: Story = {
  render: () => (
    <Stage>
      <StateRow label="country: d · s (вибрана) · x (неактивна)">
        <Chip variant="country" flag="FR">Франція</Chip>
        <Chip variant="country" flag="IT" selected>Італія</Chip>
        <Chip variant="country" flag="ES" disabled>Іспанія</Chip>
      </StateRow>
    </Stage>
  ),
};

export const Zone: Story = {
  render: () => (
    <Stage>
      <StateRow label="zone: минулий ✓ · зараз (коралова межа, точка, слово) · найближчий (жовтий, годинник, час) · майбутній">
        <Chip variant="zone" zoneState="past">UTC+13</Chip>
        <Chip variant="zone" zoneState="live">UTC+12</Chip>
        <Chip variant="zone" zoneState="next" time="03:00">UTC+11</Chip>
        <Chip variant="zone" zoneState="future">UTC+10</Chip>
      </StateRow>
      <StateRow label="zone: вибраний пояс">
        <Chip variant="zone" zoneState="next" time="03:00" selected>UTC+11</Chip>
      </StateRow>
    </Stage>
  ),
};

function FilterDemo() {
  const [on, setOn] = useState(false);
  return (
    <Stage>
      <StateRow label="filter: перемикається (aria-pressed)">
        <Chip variant="filter" selected={on} onSelectedChange={setOn}>У моєму графіку</Chip>
        <Chip variant="filter">Лише з трансляціями</Chip>
        <Chip variant="filter" disabled>Лише наживо</Chip>
      </StateRow>
    </Stage>
  );
}
export const Filter: Story = { render: () => <FilterDemo /> };

function MoreDemo() {
  const [open, setOpen] = useState(false);
  return (
    <Stage>
      <StateRow label="more: «Ще N» ↔ «Згорнути» (aria-expanded)">
        <ChipGroup label="Країни поясу">
          <Chip variant="country" flag="FR">Франція</Chip>
          <Chip variant="country" flag="DE">Німеччина</Chip>
          {open && <Chip variant="country" flag="IT">Італія</Chip>}
          {open && <Chip variant="country" flag="ES">Іспанія</Chip>}
          <Chip variant="more" count={14} expanded={open} onClick={() => setOpen((v) => !v)} />
        </ChipGroup>
      </StateRow>
    </Stage>
  );
}
export const More: Story = { render: () => <MoreDemo /> };

export const ScrollingRow: Story = {
  name: 'Ряд країн поясу (гортається вбік, телефон)',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <ChipGroup label="Країни поясу" scroll>
        <Chip variant="country" flag="UA" selected>Україна</Chip>
        <Chip variant="country" flag="FR">Франція</Chip>
        <Chip variant="country" flag="DE">Німеччина</Chip>
        <Chip variant="country" flag="IT">Італія</Chip>
        <Chip variant="country" flag="ES">Іспанія</Chip>
      </ChipGroup>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Chip variant="country" flag="FR">Франція</Chip>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
