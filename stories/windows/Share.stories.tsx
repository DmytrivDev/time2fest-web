import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, fireEvent, userEvent, within } from 'storybook/test';
import { ShareContent } from '@/components/windows/Share';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/Share',
  component: ShareContent,
  globals: { surface: 'phone' },
  args: { data: { place: 'Сідней', time: '12:00', url: 'https://time2fest.com/country/australia/' } },
  decorators: [
    (Story) => (
      <CoralProvider>
        <Stage>
          <Story />
        </Stage>
      </CoralProvider>
    ),
  ],
} satisfies Meta<typeof ShareContent>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = {
  name: 'прев’ю 9:16 — Phone-Share',
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await fireEvent.load(c.getByRole('img'));
    await expect(c.getByRole('button', { name: 'Поділитися…' })).toBeInTheDocument();
  },
};

export const Desktop: Story = { name: 'Desk-Share', globals: { surface: 'desktop' } };

export const Generating: Story = { name: 'генерується — скелетон, поки картка малюється' };

export const Square: Story = {
  name: 'прев’ю 1:1',
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('radio', { name: '1:1' }));
  },
};
