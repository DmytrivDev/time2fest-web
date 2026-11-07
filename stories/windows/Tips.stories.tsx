import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { InFlowSlot } from '@/components/primitives/Panel';
import { Tips } from '@/components/windows/Tips';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/Tips',
  component: Tips,
  globals: { surface: 'phone' },
  args: { onClose: () => undefined },
  decorators: [
    (Story) => (
      <CoralProvider>
        <Stage>
          <InFlowSlot reserveHeight={120}>
            <Story />
          </InFlowSlot>
        </Stage>
      </CoralProvider>
    ),
  ],
} satisfies Meta<typeof Tips>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: 'чайові «Тост у чаті» — телефон' };

export const Desktop: Story = { name: 'чайові «Тост у чаті» — десктоп', globals: { surface: 'desktop' } };

export const FiveDollars: Story = {
  name: 'вибрано $10 — «Підтримати $10»',
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('radio', { name: /^\$10/ }));
    await expect(c.getByRole('button', { name: 'Підтримати $10' })).toBeInTheDocument();
  },
};
