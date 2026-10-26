import type { Meta, StoryObj } from '@storybook/nextjs';
import { Scrim } from '@/components/primitives/Sheet';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Scrim', component: Scrim, globals: { surface: 'phone' } } satisfies Meta<typeof Scrim>;
export default meta;
type Story = StoryObj<typeof meta>;

export const BelowPlayer: Story = {
  name: 'Затемнення лише нижче плеєра (top = низ відео)',
  render: () => (
    <Stage>
      <div className="flex aspect-video w-full items-center justify-center bg-surface text-text-muted">Плеєр (без затемнення)</div>
      <p className="text-body">Вміст сторінки під затемненням.</p>
      <Scrim top={260} />
    </Stage>
  ),
};

export const WithoutPlayer: Story = {
  name: 'Сторінка без плеєра (top = 0)',
  render: () => (
    <Stage>
      <p className="text-body">Вміст сторінки.</p>
      <Scrim />
    </Stage>
  ),
};
