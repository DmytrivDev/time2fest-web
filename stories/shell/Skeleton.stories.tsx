import type { Meta, StoryObj } from '@storybook/nextjs';
import { PageSkeleton } from '@/components/shell/Skeleton';

const meta = { title: 'Оболонка/PageSkeleton', component: PageSkeleton } satisfies Meta<typeof PageSkeleton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: 'Телефон 390 (Phone-Skeleton)', globals: { surface: 'phone' } };

export const Desktop: Story = {
  name: 'Десктоп 1440 (Desk-Skeleton, з колонкою чату)',
  globals: { surface: 'desktop' },
  args: { mode: 'full' },
};

export const ReducedMotion: Story = {
  name: 'Зменшений рух (без відблиску)',
  globals: { surface: 'phone' },
  decorators: [
    (Story) => {
      document.documentElement.dataset.reduceMotion = 'true';
      return <Story />;
    },
  ],
};
