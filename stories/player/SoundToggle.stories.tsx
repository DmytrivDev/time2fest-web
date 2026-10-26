import type { Meta, StoryObj } from '@storybook/nextjs';
import { SoundToggle } from '@/components/player/SoundToggle';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Плеєр/SoundToggle',
  component: SoundToggle,
  args: { muted: true, available: true },
} satisfies Meta<typeof SoundToggle>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  name: 'вимкнено (coral) · увімкнено (secondary) · x (відео немає)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <StateRow label="вимкнено — coral «Увімкнути звук»">
        <SoundToggle {...args} muted />
      </StateRow>
      <StateRow label="увімкнено — secondary «Звук увімкнено»">
        <SoundToggle {...args} muted={false} />
      </StateRow>
      <StateRow label="x — відео немає (сцена відліку, Facebook без згоди): неактивна, причина в доступній назві">
        <SoundToggle {...args} available={false} />
      </StateRow>
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон — лише іконка 44×44 (назва в aria-label)',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <div className="flex gap-3">
        <SoundToggle {...args} muted />
        <SoundToggle {...args} muted={false} />
        <SoundToggle {...args} available={false} />
      </div>
    </Stage>
  ),
};
