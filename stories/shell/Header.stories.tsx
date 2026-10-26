import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Header } from '@/components/shell/Header';

const meta = {
  title: 'Оболонка/Header',
  component: Header,
  args: { current: 'home' },
} satisfies Meta<typeof Header>;
export default meta;
type Story = StoryObj<typeof meta>;

// Телефон 56 px · планшет · десктоп 64 px: різниця лише в CSS, склад — за ІНВ C23.
export const Phone: Story = { name: 'Телефон 390 (56 px)', globals: { viewport: { value: 'phone', isRotated: false } } };

export const PhoneWithPass: Story = { name: 'Телефон · «Пас ✓»', globals: { viewport: { value: 'phone', isRotated: false } }, args: { hasPass: true } };

export const PhoneSignedIn: Story = {
  name: 'Телефон · аватар',
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: { user: { name: 'Аміра' } },
};

export const Tablet: Story = {
  name: 'Планшет 768 (Головна, Країни, мова, «Пас», вхід, меню)',
  globals: { viewport: { value: 'tablet', isRotated: false } },
};

export const Desktop: Story = { name: 'Десктоп 1440 (64 px)', globals: { viewport: { value: 'desktop', isRotated: false } } };

export const DesktopWithPass: Story = {
  name: 'Десктоп · «Новорічний пас ✓», профіль',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  args: { hasPass: true, user: { name: 'Олена' }, current: 'countries' },
};

export const MenuOpen: Story = {
  name: 'Телефон · «Меню» розгорнуто (aria-expanded)',
  globals: { viewport: { value: 'phone', isRotated: false } },
  args: { menuOpen: true },
};

export const FocusOrder: Story = {
  name: 'Фокус клавіатури (десктоп)',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  play: async () => {
    await userEvent.tab();
    await userEvent.tab();
  },
};
