import type { Meta, StoryObj } from '@storybook/nextjs';
import { InFlowSlot } from '@/components/primitives/Panel';
import { PassInfo } from '@/components/pass/PassInfo';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/PassInfo',
  component: PassInfo,
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
} satisfies Meta<typeof PassInfo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { name: 'Що дає пас — Phone-Pass-Info' };

