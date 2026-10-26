import type { Meta, StoryObj } from '@storybook/nextjs';
import { Button } from '@/components/primitives/Button';
import { VisuallyHidden } from '@/components/primitives/a11y/VisuallyHidden';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/VisuallyHidden', component: VisuallyHidden } satisfies Meta<typeof VisuallyHidden>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stage>
      <StateRow label="текст лише для зчитувача: на екрані його немає, у дереві доступності є">
        <Button variant="secondary">
          Поділитися
          <VisuallyHidden> трансляцією з Лондона</VisuallyHidden>
        </Button>
      </StateRow>
      <h1>
        <VisuallyHidden>Новий рік наживо</VisuallyHidden>
      </h1>
    </Stage>
  ),
};
