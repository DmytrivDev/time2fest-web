import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Sheet } from '@/components/primitives/Sheet';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Sheet', component: Sheet, globals: { surface: 'phone' } } satisfies Meta<typeof Sheet>;
export default meta;
type Story = StoryObj<typeof meta>;

const Rows = () => (
  <ul className="flex flex-col gap-3 text-body">
    {['Лондон · Біг-Бен', 'Париж · Ейфелева вежа', 'Сідней · міст', 'Дубай · Бурдж-Халіфа'].map((r) => (
      <li key={r}>{r}</li>
    ))}
  </ul>
);

function Demo({ loading = false, withPlayer = false }: { loading?: boolean; withPlayer?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <Stage>
      {withPlayer ? (
        // Імітація закріпленого плеєра: аркуш і затемнення починаються під ним.
        <div data-player-slot="main" className="flex aspect-video w-full items-center justify-center bg-surface text-text-muted">
          Плеєр
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Відкрити аркуш
      </Button>
      <Sheet open={open} onOpenChange={setOpen} title="Обрати трансляцію" description="Одна трансляція на головній" loading={loading}>
        <Rows />
      </Sheet>
    </Stage>
  );
}

export const Open: Story = {
  name: 'o — відкритий (×, Esc, свайп униз за ручку, дотик по затемненню)',
  args: { open: true, onOpenChange: () => undefined, title: '' },
  render: () => <Demo />,
};

export const Loading: Story = {
  name: 'l — завантаження (скелетон рядків)',
  args: { open: true, onOpenChange: () => undefined, title: '' },
  render: () => <Demo loading />,
};

export const UnderPlayer: Story = {
  name: 'Під плеєром: верх аркуша й затемнення не заходять на відео',
  args: { open: true, onOpenChange: () => undefined, title: '' },
  render: () => <Demo withPlayer />,
};
