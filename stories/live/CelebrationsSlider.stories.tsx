import type { Meta, StoryObj } from '@storybook/nextjs';
import { CelebrationsSlider } from '@/components/live/CelebrationsSlider';
import { Stage } from '../_support/Stage';
import { withUs1Messages } from '../_support/us1Messages';
import { STRIP, sceneTime } from '../_support/liveFixtures';

const meta = {
  title: 'Живий ефір/CelebrationsSlider',
  component: CelebrationsSlider,
  decorators: [withUs1Messages],
  parameters: { time: sceneTime },
  args: { items: STRIP.filter((i) => i.celebrationType === 'main') },
} satisfies Meta<typeof CelebrationsSlider>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = {
  name: 'Десктоп: основні святкування',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <CelebrationsSlider {...args} />
    </Stage>
  ),
};

export const Phone: Story = {
  name: 'Телефон: гортається вбік, стрілки лише з потрібного боку',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <CelebrationsSlider {...args} />
    </Stage>
  ),
};
