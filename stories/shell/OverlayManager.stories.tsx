import type { Meta, StoryObj } from '@storybook/nextjs';
import { Button } from '@/components/primitives/Button';
import { TextField } from '@/components/primitives/TextField';
import { OverlayInFlowOutlet, OverlayManager, useOverlay } from '@/components/shell/OverlayManager';
import { CoralProvider } from '@/lib/overlay/coral';

const meta = { title: 'Оболонка/OverlayManager', component: OverlayManager } satisfies Meta<typeof OverlayManager>;
export default meta;
type Story = StoryObj<typeof meta>;

function Triggers() {
  const { open, close, current } = useOverlay();
  return (
    <div className="flex flex-wrap items-center gap-3 p-4">
      <Button
        variant="secondary"
        onClick={() =>
          open({ id: 'O-NICK', kind: 'form', title: 'Твій нік', content: <TextField label="Нік" />, closeOn: [] })
        }
      >
        Нік (з введенням)
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          open({ id: 'O-LANGUAGE', kind: 'nonmodal', title: 'Мова сайту', content: <p className="text-body">Українська, English…</p> })
        }
      >
        Мова (немодальне)
      </Button>
      <Button
        variant="secondary"
        onClick={() =>
          open({
            id: 'O-ACHIEVEMENT',
            kind: 'inflow',
            title: 'Штамп',
            content: (
              <div className="rounded-lg border border-border bg-surface p-4 text-body">Штамп у паспорті · Поділитися</div>
            ),
          })
        }
      >
        Штамп (під плеєром)
      </Button>
      <Button variant="ghost" onClick={() => close()}>
        Закрити
      </Button>
      <span className="text-caption text-text-muted">Відкрито: {current?.id ?? 'нічого'}</span>
    </div>
  );
}

function Shell() {
  return (
    <CoralProvider>
      <OverlayManager>
        <div className="mx-auto flex max-w-content-max gap-4">
          <main className="min-w-0 flex-1">
            <div data-player-slot="main" className="flex aspect-video w-full items-center justify-center bg-surface text-text-muted">
              Плеєр
            </div>
            <OverlayInFlowOutlet reserveHeight={72} />
            <Triggers />
          </main>
          {/* Колонка чату є на планшеті-альбомі й десктопі; на телефоні вікна з введенням відкриваються аркушем. */}
          <aside id="chat" aria-label="Чат" className="t2f-hide-until-desktop relative h-screen w-90 shrink-0 border-l border-border">
            <div id="chat-slot" className="relative h-full" />
          </aside>
        </div>
      </OverlayManager>
    </CoralProvider>
  );
}

export const Desktop: Story = {
  name: 'Десктоп: панель на місці чату; штамп — під плеєром',
  globals: { surface: 'desktop' },
  render: () => <Shell />,
};

export const Phone: Story = {
  name: 'Телефон: Sheet під плеєром; штамп — під плеєром',
  globals: { surface: 'phone' },
  render: () => <Shell />,
};
