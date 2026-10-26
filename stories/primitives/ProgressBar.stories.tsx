import type { Meta, StoryObj } from '@storybook/nextjs';
import { ProgressBar } from '@/components/primitives/ProgressBar';
import { Stage } from '../_support/Stage';

const meta = {
  title: 'Примітиви/ProgressBar',
  component: ProgressBar,
  args: { value: 13, max: 26, label: 'Прогрес свята', valueText: 'Минуло 13 год із 26' },
} satisfies Meta<typeof ProgressBar>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stage className="max-w-96">
      <ProgressBar
        value={13}
        max={26}
        label="Прогрес свята"
        valueText="Минуло 13 год із 26, Новий рік зустріли 23 пояси з 38"
        caption="Минуло 13 год із 26 · Новий рік зустріли 23 пояси з 38"
      />
    </Stage>
  ),
};

export const Edges: Story = {
  name: 'Початок і кінець',
  render: () => (
    <Stage className="max-w-96">
      <ProgressBar value={0} max={26} label="Прогрес свята" valueText="Минуло 0 год із 26" caption="Минуло 0 год із 26" />
      <ProgressBar value={26} max={26} label="Прогрес свята" valueText="Минуло 26 год із 26" caption="Минуло 26 год із 26" />
    </Stage>
  ),
};

export const NoVisibleCaption: Story = {
  name: 'Без видимого підпису (лише для зчитувача)',
  render: () => (
    <Stage className="max-w-96">
      <ProgressBar value={5} max={26} label="Прогрес свята" valueText="Минуло 5 год із 26" />
    </Stage>
  ),
};
