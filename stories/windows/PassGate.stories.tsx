import type { Meta, StoryObj } from '@storybook/nextjs';
import { InFlowSlot } from '@/components/primitives/Panel';
import { PassGate } from '@/components/pass/PassGate';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/PassGate',
  component: PassGate,
  globals: { surface: 'phone' },
  args: { onClose: () => undefined, onWhatPassGives: () => undefined },
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
} satisfies Meta<typeof PassGate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Schedule: Story = { name: 'графік — Phone-Pass-Gate' };

export const Desktop: Story = { name: 'Desk-Pass-Gate', globals: { surface: 'desktop' } };

export const QuietMode: Story = { name: 'тихий режим чату', args: { feature: 'quiet-mode' } };

export const SecondReminder: Story = { name: 'друге нагадування', args: { feature: 'second-reminder' } };
