import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import { CountryChips, type CountryChipsProps } from '@/components/live/CountryChips';
import { Stage, StateRow } from '../_support/Stage';
import { ZONE_COUNTRIES } from '../_support/liveFixtures';

const meta = {
  title: 'Живий ефір/CountryChips',
  component: CountryChips,
  args: { countries: ZONE_COUNTRIES, selectedIso: 'FR' },
} satisfies Meta<typeof CountryChips>;
export default meta;
type Story = StoryObj<typeof meta>;

function Pick(props: CountryChipsProps) {
  const [iso, setIso] = useState('FR');
  return <CountryChips {...props} selectedIso={iso} onSelect={setIso} />;
}

export const States: Story = {
  name: 'Згорнутий («Ще N») · розгорнутий · без «Ще» · вибір',
  render: (args) => (
    <Stage>
      <StateRow label="згорнутий: 6 чипів і «Ще 3»">
        <CountryChips {...args} />
      </StateRow>
      <StateRow label="розгорнутий: «Згорнути»">
        <CountryChips {...args} defaultExpanded />
      </StateRow>
      <StateRow label="пояс із двома країнами — «Ще» немає">
        <CountryChips {...args} countries={ZONE_COUNTRIES.slice(0, 2)} />
      </StateRow>
      <StateRow label="вибір (клік змінює вибрану країну)">
        <Pick {...args} />
      </StateRow>
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон: переноситься на другий рядок',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <CountryChips {...args} defaultExpanded />
    </Stage>
  ),
};

export const Focus: Story = {
  name: 'f — фокус клавіатури',
  render: (args) => (
    <Stage>
      <CountryChips {...args} />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
