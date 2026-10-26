import type { Meta, StoryObj } from '@storybook/nextjs';
import { Button } from '@/components/primitives/Button';
import { LiveAnnouncer, useAnnounce } from '@/components/primitives/a11y/LiveAnnouncer';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/LiveAnnouncer', component: LiveAnnouncer } satisfies Meta<typeof LiveAnnouncer>;
export default meta;
type Story = StoryObj<typeof meta>;

function Buttons() {
  const announce = useAnnounce();
  return (
    <StateRow label="одна ввічлива область на сторінку; повідомлення не частіше за інтервал, повтор поспіль ігнорується">
      <Button variant="secondary" onClick={() => announce('До півночі 10 хвилин')}>
        Оголосити віху
      </Button>
      <Button variant="secondary" onClick={() => announce('До півночі 1 хвилина')}>
        Оголосити наступну
      </Button>
      <Button variant="ghost" onClick={() => announce('Запізніла подія', { late: true })}>
        Запізніла (не оголошується)
      </Button>
    </StateRow>
  );
}

export const Default: Story = {
  render: () => (
    <LiveAnnouncer minIntervalMs={1_000}>
      <Stage>
        <Buttons />
        <p className="text-caption text-text-muted">Область невидима: перевірка — role=status, aria-live=polite у дереві.</p>
      </Stage>
    </LiveAnnouncer>
  ),
};
