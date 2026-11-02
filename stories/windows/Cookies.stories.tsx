import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { CookieBanner, CookieSettings } from '@/components/windows/Cookies';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Вікна/Cookies',
  component: CookieBanner,
  globals: { surface: 'phone' },
  args: { variant: 'card', className: 'bottom-3 inset-x-3' },
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

export const Card: Story = { name: 'card — телефон вертикально (над «Розгорнути чат»)' };

export const Bar: Story = {
  name: 'bar — десктоп (завширшки з колонку відео)',
  globals: { surface: 'desktop' },
  args: { variant: 'bar', className: 'bottom-4 inset-x-8' },
};

export const BarCompact: Story = {
  name: 'bar compact — телефон горизонтально',
  args: { variant: 'bar', compact: true, className: 'bottom-3 inset-x-3' },
};

export const SaveFailed: Story = {
  name: 'вибір не збережено — тихий рядок і «Спробувати ще»',
  globals: { surface: 'desktop' },
  args: { variant: 'bar', saveFailed: true, className: 'bottom-4 inset-x-8' },
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
