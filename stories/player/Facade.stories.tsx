import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Facade } from '@/components/player/Facade';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Плеєр/Facade',
  component: Facade,
  args: { videoId: 'dQw4w9WgXcQ', title: 'Лондон · Біг-Бен' },
} satisfies Meta<typeof Facade>;
export default meta;
type Story = StoryObj<typeof meta>;

export const States: Story = {
  render: (args) => (
    <Stage>
      <StateRow label="d — обкладинка з кнопкою «Грати» (мініатюра, не плеєр; звук не вмикається)">
        <div className="w-full max-w-md">
          <Facade {...args} />
        </div>
      </StateRow>
      <StateRow label="l — плеєр вантажиться після кліку">
        <div className="w-full max-w-md">
          <Facade {...args} loading />
        </div>
      </StateRow>
    </Stage>
  ),
};

export const Focus: Story = {
  render: (args) => (
    <Stage>
      <div className="w-full max-w-md">
        <Facade {...args} />
      </div>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
