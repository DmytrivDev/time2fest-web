import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { ChatSlotPanel, type ChatSlotPanelVariant } from '@/components/primitives/Panel';
import { TextField } from '@/components/primitives/TextField';

const meta = { title: 'Примітиви/ChatSlotPanel', component: ChatSlotPanel, globals: { surface: 'desktop' } } satisfies Meta<typeof ChatSlotPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Колонка чату 360 px, як у LiveShell: панель займає її місце. */
function Column({ variant, title, withField }: { variant: ChatSlotPanelVariant; title: string; withField: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <div className="flex h-screen justify-between gap-4 p-4">
      <div className="flex-1">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          Відкрити панель
        </Button>
      </div>
      <aside aria-label="Чат" className="relative h-full w-90 shrink-0 border-l border-border">
        <div id="chat-slot" className="relative h-full" />
      </aside>
      <ChatSlotPanel open={open} onOpenChange={setOpen} variant={variant} title={title} description="Панель на місці чату">
        {withField ? <TextField label="Нік" /> : <p className="text-body">Мова сайту, «Зменшити рух», «Допомога».</p>}
      </ChatSlotPanel>
    </div>
  );
}

const base = { open: true, onOpenChange: () => undefined, title: '' };

export const Form: Story = {
  name: 'form — з введенням (фокус усередині, дотик поза панеллю не закриває)',
  args: base,
  render: () => <Column variant="form" title="Твій нік" withField />,
};

export const Nonmodal: Story = {
  name: 'nonmodal — «Назад» / Esc повертає фокус на тригер',
  args: base,
  render: () => <Column variant="nonmodal" title="Мова сайту" withField={false} />,
};

export const Accent: Story = {
  name: 'accent — вікно з кораловою кнопкою («Усе про пас»)',
  args: base,
  render: () => <Column variant="accent" title="Новорічний пас" withField />,
};
