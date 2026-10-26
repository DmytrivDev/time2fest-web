import type { Meta, StoryObj } from '@storybook/nextjs';
import { InFlowSlot } from '@/components/primitives/Panel';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/InFlowSlot', component: InFlowSlot, globals: { surface: 'phone' } } satisfies Meta<typeof InFlowSlot>;
export default meta;
type Story = StoryObj<typeof meta>;

const Card = ({ children }: { children: string }) => (
  <div className="rounded-lg border border-border bg-surface p-4 text-body">{children}</div>
);

export const States: Story = {
  render: () => (
    <Stage>
      <StateRow label="порожній (місце зарезервоване, вміст під ним не стрибає)">
        <InFlowSlot reserveHeight={72} className="border border-dashed border-border" />
      </StateRow>
      <StateRow label="зайнятий (одне вікно за раз, aria-live=polite, фокус не переносить)">
        <InFlowSlot reserveHeight={72}>
          <Card>Штамп у паспорті · Поділитися</Card>
        </InFlowSlot>
      </StateRow>
      <p className="text-body text-text-secondary">Вміст сторінки під слотом.</p>
    </Stage>
  ),
};
