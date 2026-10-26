import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { CookieBanner, CookieSettings } from '@/components/windows/Cookies';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/Cookies',
  component: CookieBanner,
  globals: { surface: 'phone' },
  args: { variant: 'strip' },
  decorators: [
    (Story) => (
      <CoralProvider>
        <Stage className="min-h-60">
          <Story />
        </Stage>
      </CoralProvider>
    ),
  ],
} satisfies Meta<typeof CookieBanner>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Strip: Story = { name: 'strip — Phone-Cookies (смуга внизу)' };

export const Corner: Story = {
  name: 'corner — Desk-Cookies (лівий нижній кут, ≤ 360 px)',
  globals: { surface: 'desktop' },
  args: { variant: 'corner' },
};

export const Inflow: Story = {
  name: 'inflow — Desk-Cookies-Wide (чат сховано: смуга на місці штампа)',
  globals: { surface: 'desktop' },
  args: { variant: 'inflow' },
};

export const SaveFailed: Story = {
  name: 'вибір не збережено — тихий рядок і «Спробувати ще»',
  args: { variant: 'inflow', saveFailed: true },
};

export const Settings: Story = {
  name: 'CookieSettings — Phone-Cookies-Settings (4 категорії)',
  render: () => <CookieSettings value={{ analytics: false, marketing: false, facebookVideo: true }} />,
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getAllByRole('switch')).toHaveLength(4);
    await userEvent.click(c.getByRole('switch', { name: 'Аналітика' }));
    await expect(c.getByRole('switch', { name: 'Аналітика' })).toBeChecked();
    await expect(c.getByRole('switch', { name: 'Необхідні' })).toBeDisabled();
  },
};
