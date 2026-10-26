import type { Meta, StoryObj } from '@storybook/nextjs';
import { ErrorContent } from '@/components/shell/ErrorContent';
import { NotFoundContent } from '@/components/shell/NotFoundContent';
import { StaticShell } from '@/components/shell/StaticShell';

const meta = { title: 'Оболонка/Сторінки 404 і помилки', parameters: { layout: 'fullscreen' } } satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const notFound = (
  <StaticShell>
    <NotFoundContent />
  </StaticShell>
);

export const NotFoundPhone: Story = {
  name: 'Phone-404 · телефон 390',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => notFound,
};

export const NotFoundDesktop: Story = {
  name: 'Desk-404 · десктоп 1440',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: () => notFound,
};

export const ErrorPhone: Story = {
  name: 'Phone-Error · телефон 390',
  globals: { viewport: { value: 'phone', isRotated: false } },
  render: () => (
    <StaticShell>
      <ErrorContent onRetry={() => undefined} />
    </StaticShell>
  ),
};

export const ErrorDesktop: Story = {
  name: 'Desk-Error · десктоп 1440 (артборда немає)',
  globals: { viewport: { value: 'desktop', isRotated: false } },
  render: () => (
    <StaticShell>
      <ErrorContent onRetry={() => undefined} />
    </StaticShell>
  ),
};
