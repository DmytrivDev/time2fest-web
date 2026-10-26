import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState, type ReactNode } from 'react';
import type { FirstRowEditProps } from '@/components/firstrow/types';
import { FirstRowEdit, FirstRowPending, FirstRowSoldOut, FirstRowSuccess } from '@/components/windows/FirstRowResult';
import { Stage } from '../_support/Stage';

const MIDNIGHT = Date.parse('2026-12-31T20:00:00Z');
const HOLD_UNTIL = MIDNIGHT - 3_000_000;

type Box = (c: ReactNode) => ReactNode;
const sheet: Box = (c) => <div className="rounded-lg border border-border bg-surface p-4">{c}</div>;
/** Імітація акцентної панелі чату на десктопі (ChatSlotPanel `accent`). */
const panel: Box = (c) => <div className="mx-auto w-full max-w-sm rounded-lg border border-highlight bg-surface p-4">{c}</div>;

const noop = () => undefined;
const meta = {
  title: 'Перший ряд/FirstRowResult',
  globals: { surface: 'phone' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const pending = (box: Box) => (
  <Stage>
    {box(
      <FirstRowPending
        city="Дубай"
        midnightMs={MIDNIGHT}
        freeCount={3}
        total={10}
        preview={{ name: 'Олена і друзі', emojiId: 'glasses' }}
        holdUntil={HOLD_UNTIL}
        email="olena@example.com"
        onClose={noop}
        onHelp={noop}
      />,
    )}
  </Stage>
);
export const PhonePending: Story = { name: 'Phone-FR-Pending', render: () => pending(sheet) };
export const DeskPending: Story = { name: 'Desk-FR-Pending', globals: { surface: 'desktop' }, render: () => pending(panel) };

const success = (box: Box, pass: 'gifted' | 'discount' = 'gifted') => (
  <Stage>
    {box(
      <FirstRowSuccess
        city="Дубай"
        cityId="dubai"
        midnightMs={MIDNIGHT}
        seat={4}
        name="Олена і друзі"
        flagCode="UA"
        emojiId="glasses"
        greeting="З Новим роком з Києва!"
        email="olena@example.com"
        pass={pass}
        ticketCode="DXB-04"
        onShare={noop}
        onEdit={noop}
      />,
    )}
  </Stage>
);
export const PhoneSuccess: Story = { name: 'Phone-FR-Success', render: () => success(sheet) };
export const DeskSuccess: Story = { name: 'Desk-FR-Success', globals: { surface: 'desktop' }, render: () => success(panel) };
export const SuccessDiscount: Story = { name: 'success — знижка пасу', render: () => success(sheet, 'discount') };

const soldOut = (box: Box) => <Stage>{box(<FirstRowSoldOut city="Дубай" onBack={noop} otherHref="/countries" />)}</Stage>;
export const PhoneSoldOut: Story = { name: 'Phone-FR-SoldOut', render: () => soldOut(sheet) };
export const DeskSoldOut: Story = { name: 'Desk-FR-SoldOut', globals: { surface: 'desktop' }, render: () => soldOut(panel) };

function EditLive({ emojiWaitSec, errors, greeting }: Pick<FirstRowEditProps, 'emojiWaitSec' | 'errors'> & { greeting?: string }) {
  const [values, setValues] = useState({ name: 'Олена і друзі', greeting: greeting ?? 'З Новим роком з Києва!', emojiId: 'glasses' });
  return (
    <FirstRowEdit
      city="Дубай"
      seat={4}
      values={values}
      onChange={(p) => setValues((v) => ({ ...v, ...p }))}
      emojiWaitSec={emojiWaitSec}
      errors={errors}
      onSave={noop}
      onCancel={noop}
    />
  );
}
export const PhoneEdit: Story = { name: 'Phone-FR-Edit', render: () => <Stage>{sheet(<EditLive emojiWaitSec={0} />)}</Stage> };
export const DeskEdit: Story = {
  name: 'Desk-FR-Edit',
  globals: { surface: 'desktop' },
  render: () => <Stage>{panel(<EditLive emojiWaitSec={0} />)}</Stage>,
};
export const EditEmojiWait: Story = {
  name: 'edit — емоцію змінюють раз на 10 с',
  render: () => <Stage>{sheet(<EditLive emojiWaitSec={6} />)}</Stage>,
};
export const EditModeration: Story = {
  name: 'edit — moderation error',
  render: () => (
    <Stage>{sheet(<EditLive emojiWaitSec={0} greeting="Заходь на t.me/spam" errors={{ greeting: 'moderation' }} />)}</Stage>
  ),
};
