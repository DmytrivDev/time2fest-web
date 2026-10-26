import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { useState } from 'react';
import { InFlowSlot } from '@/components/primitives/Panel';
import { Rate, type RateProps, type RateRow } from '@/components/windows/Rate';
import type { Stars } from '@/lib/data/types';
import { Stage } from '../_support/Stage';
import { PendingIntl } from '../us1/PendingIntl';

const LONDON: RateRow = { eventId: 'evt_london_2027', countryName: 'Велика Британія', city: 'Лондон', flagCode: 'GB' };
const DUBLIN: RateRow = { eventId: 'evt_dublin_2027', countryName: 'Ірландія', city: 'Дублін', flagCode: 'IE' };

const meta = {
  title: 'Вікна/Rate',
  component: Rate,
  globals: { surface: 'phone' },
  args: { rows: [LONDON] },
  decorators: [
    (Story) => (
      <PendingIntl>
        <Stage>
          <InFlowSlot reserveHeight={120}>
            <Story />
          </InFlowSlot>
        </Stage>
      </PendingIntl>
    ),
  ],
} satisfies Meta<typeof Rate>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = { name: 'відкрито — Phone-Rate' };

export const Multi: Story = {
  name: 'кілька подій — кілька рядків',
  args: { rows: [LONDON, DUBLIN] },
};

export const Rated: Story = {
  name: 'оцінено — «Дякуємо»',
  args: { ratings: { evt_london_2027: 4 } },
};

export const SendError: Story = {
  name: 'помилка надсилання',
  args: { status: 'error', ratings: { evt_london_2027: 4 } },
};

export const Closed: Story = {
  name: 'закрито — нічого не малюється (більше не з’являється)',
  args: { status: 'closed' },
  render: (args) => (
    <>
      <Rate {...args} />
      <p className="text-caption text-text-muted">Картку закрито: у слоті порожньо.</p>
    </>
  ),
};

function Interactive(args: RateProps) {
  const [ratings, setRatings] = useState<Partial<Record<string, Stars>>>({});
  const [log, setLog] = useState<string>('—');
  return (
    <>
      <Rate
        {...args}
        ratings={ratings}
        onRate={(id, s) => setRatings((r) => ({ ...r, [id]: s }))}
        onInteractionChange={(v) => setLog(v ? 'є взаємодія (не закривати)' : 'немає взаємодії')}
      />
      <p className="mt-2 text-caption text-text-muted" data-testid="interaction">
        {log}
      </p>
    </>
  );
}

export const Interaction: Story = {
  name: 'фокус усередині = взаємодія (WCAG 2.2.1); вибір зірки',
  render: (args) => <Interactive {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.tab();
    await expect(canvas.getByTestId('interaction')).toHaveTextContent('є взаємодія');
    await userEvent.click(canvas.getByRole('radio', { name: '5 з 5' }));
    await expect(canvas.getByText('Дякуємо')).toBeInTheDocument();
  },
};

export const Desktop: Story = {
  name: 'десктоп — Desk-Rate',
  globals: { surface: 'desktop' },
};
