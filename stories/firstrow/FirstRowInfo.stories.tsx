import type { Meta, StoryObj } from '@storybook/nextjs';
import { FirstRowInfo } from '@/components/windows/FirstRowInfo';
import { Stage } from '../_support/Stage';
import { makeView, MIDNIGHT } from './fixtures';

const noop = () => undefined;

const meta = {
  title: 'Перший ряд/FirstRowInfo',
  component: FirstRowInfo,
  globals: { surface: 'desktop' },
  args: { city: 'Лондон', midnightMs: MIDNIGHT, onTake: noop, onClose: noop, ...makeView({ taken: 8 }) },
  render: (args) => (
    <Stage>
      <FirstRowInfo {...args} />
    </Stage>
  ),
} satisfies Meta<typeof FirstRowInfo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Desktop: Story = { name: 'Desk-FR-Info — лишилось 2 місця' };
export const Phone: Story = { name: 'Phone-FR-Info', globals: { surface: 'phone' } };
export const PassDiscount: Story = { name: 'Desk-FR-Info — pass-discount', args: makeView({ taken: 8, pass: true }) };
export const NoTake: Story = {
  name: 'Desk-FR-Info — продаж не відкритий (без кнопки)',
  args: { ...makeView({ taken: 8, closed: true }), onTake: undefined },
};
