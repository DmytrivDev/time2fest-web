import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { IconButton } from '@/components/primitives/IconButton';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/primitives/DropdownMenu';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/DropdownMenu', component: DropdownMenu } satisfies Meta<typeof DropdownMenu>;
export default meta;
type Story = StoryObj<typeof meta>;

function Menu({ defaultOpen }: { defaultOpen?: boolean }) {
  const [quiet, setQuiet] = useState(false);
  return (
    <Stage className="min-h-60">
      <DropdownMenu defaultOpen={defaultOpen}>
        <DropdownMenuTrigger asChild>
          <IconButton icon="more" aria-label="Ще дії чату" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuCheckboxItem checked={quiet} onCheckedChange={setQuiet}>
            Тихий режим
          </DropdownMenuCheckboxItem>
          <DropdownMenuItem>Правила чату</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled>Поскаржитись</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </Stage>
  );
}

export const Closed: Story = { name: 'd — закрите', render: () => <Menu /> };
export const Open: Story = { name: 'o — відкрите (пункти ≥ 44 px, стрілки, Esc)', render: () => <Menu defaultOpen /> };
