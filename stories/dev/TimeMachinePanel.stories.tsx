import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, within } from 'storybook/test';
import { TimeMachinePanel } from '@/components/dev/TimeMachinePanel';

/**
 * Панель «машини часу» (T085/T086). Декоратор Storybook обгортає історію тим самим
 * `TimeProvider override`, що й тулбар «Час»; панель стоїть усередині цієї обгортки.
 */
const meta = {
  title: 'Dev/TimeMachinePanel',
  component: TimeMachinePanel,
  args: { defaultOpen: true },
  parameters: { time: { at: '2027-01-01T01:38:00+02:00', speed: 0 } },
} satisfies Meta<typeof TimeMachinePanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = {
  name: 'Телефон 390 (стартовий момент, час стоїть)',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    const dialog = await within(canvasElement.ownerDocument.body).findByRole('dialog');
    await expect(dialog).toHaveAttribute('aria-modal', 'false');
  },
};

export const Desktop: Story = {
  name: 'Десктоп 1440 (у колонці чату)',
  globals: { surface: 'desktop' },
};

export const MidnightRunning: Story = {
  name: 'Північ Лондона, ×10',
  globals: { surface: 'desktop' },
  parameters: { time: { at: '2026-12-31T23:59:50Z', speed: 10 } },
};

export const FestivalOver: Story = {
  name: 'Свято скінчилося (стрибки неактивні)',
  globals: { surface: 'desktop' },
  parameters: { time: { at: '2027-01-02T20:00:00Z', speed: 0 } },
};
