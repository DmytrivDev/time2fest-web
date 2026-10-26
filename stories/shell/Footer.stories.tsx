import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Footer } from '@/components/shell/Footer';

const meta = { title: 'Оболонка/Footer', component: Footer } satisfies Meta<typeof Footer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = {
  name: 'Телефон 390 (посилання — рядки ≥ 44 px)',
  globals: { surface: 'phone' },
};

export const Desktop: Story = { name: 'Десктоп 1440 (один рядок)', globals: { surface: 'desktop' } };

export const ReducedMotionOn: Story = {
  name: '«Зменшити рух» увімкнено',
  globals: { surface: 'desktop' },
  args: { reducedMotion: true },
};

export const FocusOrder: Story = {
  name: 'Фокус клавіатури',
  globals: { surface: 'desktop' },
  play: async () => {
    await userEvent.tab();
    await userEvent.tab();
  },
};
