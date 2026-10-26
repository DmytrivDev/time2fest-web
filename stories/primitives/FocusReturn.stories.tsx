import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { FocusReturn } from '@/components/primitives/a11y/FocusReturn';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/FocusReturn', component: FocusReturn } satisfies Meta<typeof FocusReturn>;
export default meta;
type Story = StoryObj<typeof meta>;

function Demo() {
  const [open, setOpen] = useState(false);
  return (
    <Stage>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Відкрити немодальне вікно
      </Button>
      {open ? (
        <FocusReturn>
          <div className="flex items-center gap-3 rounded-lg border border-border bg-surface p-4">
            <span className="text-body">Після закриття фокус повернеться на кнопку вище.</span>
            <Button variant="tonal" onClick={() => setOpen(false)}>
              Закрити
            </Button>
          </div>
        </FocusReturn>
      ) : null}
    </Stage>
  );
}

export const Default: Story = { render: () => <Demo /> };
