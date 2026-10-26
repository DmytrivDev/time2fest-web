import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { InFlowSlot } from '@/components/primitives/Panel';
import { PassOffer } from '@/components/windows/PassOffer';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';
import { BRITAIN, FRANCE, UKRAINE } from '../_support/offerFixtures';

const meta = {
  title: 'Вікна/PassOffer',
  component: PassOffer,
  globals: { surface: 'phone' },
  args: { count: 2, countries: [UKRAINE, FRANCE], onClose: () => undefined, onDetails: () => undefined },
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
} satisfies Meta<typeof PassOffer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: 'після 2-го Нового року — Phone-Pass-Offer' };

export const Desktop: Story = { name: 'Desk-Pass-Offer', globals: { surface: 'desktop' } };

export const WroteInChat: Story = {
  name: 'писав у чаті — «−50% на «Перший ряд»» серед головних',
  args: { wroteInChat: true, count: 3, countries: [UKRAINE, FRANCE, BRITAIN] },
};

export const PaymentLater: Story = {
  name: 'після «Оформити пас» — імітоване повідомлення (оплата на наступному етапі)',
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await userEvent.click(c.getByRole('button', { name: 'Оформити пас' }));
    await expect(c.getByText('Оплата буде на наступному етапі')).toBeInTheDocument();
  },
};
