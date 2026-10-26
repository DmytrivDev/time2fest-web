import type { Meta, StoryObj } from '@storybook/nextjs';
import { BackendDown, OfflineNotice } from '@/components/shell/Offline';

const meta = { title: 'Оболонка/Offline', component: OfflineNotice } satisfies Meta<typeof OfflineNotice>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PhoneOffline: Story = {
  name: 'Телефон 390: немає з’єднання (Phone-Offline)',
  globals: { surface: 'phone' },
  args: { offline: true },
};

export const DesktopOffline: Story = {
  name: 'Десктоп 1440: немає з’єднання (не намальовано)',
  globals: { surface: 'desktop' },
  args: { offline: true },
};

export const Online: Story = {
  name: 'Мережа є (порожня область, нічого не видно)',
  globals: { surface: 'phone' },
  args: { offline: false },
};

export const BackendDownPhone: Story = {
  name: 'BackendDown, телефон',
  globals: { surface: 'phone' },
  render: () => <BackendDown />,
};

export const BackendDownDesktop: Story = {
  name: 'BackendDown, десктоп',
  globals: { surface: 'desktop' },
  render: () => <BackendDown />,
};
