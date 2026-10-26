import type { Meta, StoryObj } from '@storybook/nextjs';
import { ScrollArea } from '@/components/primitives/ScrollArea';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/ScrollArea', component: ScrollArea } satisfies Meta<typeof ScrollArea>;
export default meta;
type Story = StoryObj<typeof meta>;

const LINES = Array.from({ length: 30 }, (_, i) => `Повідомлення ${i + 1}: З Новим роком!`);

export const Vertical: Story = {
  name: 'Вертикальна — тонка смуга border-strong',
  render: () => (
    <Stage>
      <ScrollArea label="Повідомлення чату" className="h-64 w-80 rounded-lg border border-border bg-surface">
        <ul className="flex flex-col gap-2 p-3 text-chat text-text">
          {LINES.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      </ScrollArea>
    </Stage>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <Stage>
      <StateRow label="горизонтальна">
        <ScrollArea orientation="horizontal" label="Стрічка" className="w-80 rounded-lg border border-border bg-surface">
          <div className="flex w-max gap-3 p-3 pb-5 text-body text-text">
            {LINES.slice(0, 12).map((l) => (
              <span key={l} className="whitespace-nowrap">{l}</span>
            ))}
          </div>
        </ScrollArea>
      </StateRow>
    </Stage>
  ),
};
