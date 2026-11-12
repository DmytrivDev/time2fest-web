import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import { SegmentedControl, type SegmentOption } from '@/components/primitives/SegmentedControl';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/SegmentedControl',
  component: SegmentedControl,
  args: { label: 'Кімнати чату', options: [], value: '', onValueChange: () => undefined },
} satisfies Meta<typeof SegmentedControl>;
export default meta;
type Story = StoryObj<typeof meta>;

const ROOMS: SegmentOption[] = [
  { value: 'world', label: 'Світ' },
  { value: 'country', label: 'Країна' },
];
const ROOMS_DOT: SegmentOption[] = [...ROOMS, { value: 'other', label: 'Ще', dot: true }];
const TIPS: SegmentOption[] = [
  { value: '2', label: '$2' },
  { value: '5', label: '$5' },
  { value: '10', label: '$10' },
];

function Demo({ label, options, initial, semantics }: { label: string; options: SegmentOption[]; initial: string; semantics?: 'radio' | 'pressed' }) {
  const [v, setV] = useState(initial);
  return <SegmentedControl label={label} options={options} value={v} onValueChange={setV} semantics={semantics} />;
}

export const Rooms: Story = {
  name: 'Кімнати чату «Світ / Країна» (і варіант із жовтою точкою)',
  render: () => (
    <Stage>
      <StateRow label="d · s (вибраний — surface-raised + межа text)">
        <Demo label="Кімнати чату" options={ROOMS} initial="world" />
      </StateRow>
      <StateRow label="з жовтою точкою (`dot`)">
        <Demo label="Кімнати чату" options={ROOMS_DOT} initial="other" />
      </StateRow>
    </Stage>
  ),
};

export const Tips: Story = {
  name: 'Суми чайових (вибране не жовтим, I-14)',
  render: () => (
    <Stage>
      <Demo label="Сума чайових" options={TIPS} initial="5" />
    </Stage>
  ),
};

export const MapAndList: Story = {
  name: 'Мапа / Список · aria-pressed «Пояси / Звідки дивляться»',
  render: () => (
    <Stage>
      <StateRow label="radio">
        <Demo label="Вигляд" options={[{ value: 'map', label: 'Мапа' }, { value: 'list', label: 'Список' }]} initial="map" />
      </StateRow>
      <StateRow label="pressed (aria-pressed)">
        <Demo
          label="Шар мапи"
          semantics="pressed"
          options={[{ value: 'zones', label: 'Пояси' }, { value: 'viewers', label: 'Звідки дивляться' }]}
          initial="zones"
        />
      </StateRow>
    </Stage>
  ),
};

export const Disabled: Story = {
  render: () => (
    <Stage>
      <StateRow label="x — недоступний сегмент">
        <SegmentedControl
          label="Кімнати чату"
          value="world"
          onValueChange={() => undefined}
          options={[{ value: 'world', label: 'Світ' }, { value: 'country', label: 'Країна', disabled: true }]}
        />
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage>
      <Demo label="Кімнати чату" options={ROOMS} initial="world" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
