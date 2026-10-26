import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState, type ReactNode } from 'react';
import { userEvent } from 'storybook/test';
import { MiniPlayer, type MiniPlayerCorner } from '@/components/player/MiniPlayer';

const meta = {
  title: 'Плеєр/MiniPlayer',
  component: MiniPlayer,
  globals: { surface: 'desktop' },
  parameters: { layout: 'fullscreen' },
  args: { title: 'Лондон · Біг-Бен', visible: true },
} satisfies Meta<typeof MiniPlayer>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Тло десктопної сторінки: чат праворуч, який мініплеєр не перекриває. */
function Page({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-150 gap-6 bg-background p-6">
      <main className="min-w-0 flex-1 rounded-lg bg-surface p-4 text-body text-text-secondary">Сторінка прокручена нижче плеєра</main>
      <aside aria-label="Чат" className="min-h-120 w-96 shrink-0 rounded-lg bg-surface p-4 text-body text-text-secondary">
        Колонка чату
      </aside>
      {children}
    </div>
  );
}

export const Visible: Story = {
  name: 'Видимий: 356×200 і смуга керування 44 px',
  render: (args) => (
    <Page>
      <MiniPlayer {...args} />
    </Page>
  ),
};

export const Hidden: Story = {
  name: 'Прихований: нічого не рендериться',
  render: (args) => (
    <Page>
      <MiniPlayer {...args} visible={false} />
    </Page>
  ),
};

export const Focused: Story = {
  name: 'У фокусі: «Повернутися»',
  render: (args) => (
    <Page>
      <MiniPlayer {...args} />
    </Page>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

function Moving({ title }: { title: string }) {
  const [corner, setCorner] = useState<MiniPlayerCorner>('top-left');
  return <MiniPlayer title={title} visible corner={corner} onCornerChange={setCorner} />;
}

export const Moved: Story = {
  name: 'Переміщений: «Перемістити в інший кут» перемикає лівий верхній / нижній',
  render: (args) => (
    <Page>
      <Moving title={args.title} />
    </Page>
  ),
};
