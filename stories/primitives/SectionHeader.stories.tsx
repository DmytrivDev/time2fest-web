import type { Meta, StoryObj } from '@storybook/nextjs';
import { Badge } from '@/components/primitives/Badge';
import { Button } from '@/components/primitives/Button';
import { SectionHeader } from '@/components/primitives/SectionHeader';
import { Switch } from '@/components/primitives/Switch';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/SectionHeader', component: SectionHeader, args: { title: 'Зараз і далі' } } satisfies Meta<typeof SectionHeader>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <Stage className="max-w-xl">
      <SectionHeader title="Зараз і далі" meta="за вашим часом (Київ)" action={<Switch label="Лише з трансляціями" compact />} />
      <SectionHeader title="Країни поясу" action={<Button variant="ghost">Згорнути</Button>} />
      <SectionHeader title="Чат" action={<Badge variant="count" value={12} />} />
      <SectionHeader title="Без дії" as="h3" />
    </Stage>
  ),
};
