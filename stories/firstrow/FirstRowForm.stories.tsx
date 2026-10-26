import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState, type ReactNode } from 'react';
import type { FirstRowDraftValues, FirstRowFormProps } from '@/components/firstrow/types';
import { FirstRowForm } from '@/components/windows/FirstRowForm';
import { firstRowView, type FirstRowView } from '@/lib/engine/firstRowView';
import { Stage } from '../_support/Stage';

const MIDNIGHT = Date.parse('2026-12-31T20:00:00Z');
const NOW = MIDNIGHT - 3_600_000;
const EVENT = { id: 'evt_dubai_2027', midnightUtc: '2026-12-31T20:00:00Z', firstRow: { saleEnabled: true } };

/** Вигляд «Першого ряду» для гостя: 4 вільні місця, ціна $4,99; поверх — потрібні відхилення. */
function view(over: Partial<FirstRowView> = {}, pass = false): FirstRowView {
  const base = firstRowView(NOW, EVENT as never, [], { id: 'me', hasPass: pass });
  return { ...base, freeCount: 4, state: 'open', ...over };
}

const VALUES: FirstRowDraftValues = { email: 'olena@example.com', name: 'Олена і друзі', greeting: 'З Новим роком з Києва!', emojiId: 'glasses' };

const ARGS: FirstRowFormProps = {
  city: 'Дубай',
  midnightMs: MIDNIGHT,
  freeCount: 4,
  total: 10,
  view: view(),
  payPrice: 4.99,
  holdUntil: NOW + 10 * 60_000,
  values: VALUES,
  onChange: () => undefined,
  onExtend: () => undefined,
  onPay: () => undefined,
  giftPass: true,
  onLoginForPass: () => undefined,
  onHelp: () => undefined,
};

function Live(props: FirstRowFormProps) {
  const [values, setValues] = useState(props.values);
  return <FirstRowForm {...props} values={values} onChange={(p) => setValues((v) => ({ ...v, ...p }))} />;
}

/** Імітація акцентної панелі чату на десктопі (ChatSlotPanel `accent`). */
function Panel({ children }: { children: ReactNode }) {
  return <div className="mx-auto w-full max-w-sm rounded-lg border border-highlight bg-surface p-4">{children}</div>;
}
function Sheet({ children }: { children: ReactNode }) {
  return <div className="rounded-lg border border-border bg-surface p-4">{children}</div>;
}

const meta = {
  title: 'Перший ряд/FirstRowForm',
  component: FirstRowForm,
  globals: { surface: 'phone' },
  args: ARGS,
  render: (args) => (
    <Stage>
      <Sheet>
        <Live {...args} />
      </Sheet>
    </Stage>
  ),
} satisfies Meta<typeof FirstRowForm>;
export default meta;
type Story = StoryObj<typeof meta>;

const desk: Story['render'] = (args) => (
  <Stage>
    <Panel>
      <Live {...args} />
    </Panel>
  </Stage>
);

export const PhoneForm: Story = { name: 'Phone-FR-Form' };
export const DeskForm: Story = { name: 'Desk-FR-Form', globals: { surface: 'desktop' }, render: desk };

export const PhoneDeclined: Story = { name: 'Phone-FR-Declined', args: { notice: { kind: 'declined' } } };
export const DeskDeclined: Story = { name: 'Desk-FR-Declined', globals: { surface: 'desktop' }, args: { notice: { kind: 'declined' } }, render: desk };

const EXPIRED = { kind: 'expired', free: 3, price: 7.99, holdUntil: NOW + 10 * 60_000, priceChanged: true } as const;
const EXPIRED_ARGS = {
  notice: EXPIRED,
  freeCount: 3,
  view: view({ freeCount: 3, price: { ...view().price, current: 7.99, tier: 'last3' } }),
  payPrice: 7.99,
} satisfies Partial<FirstRowFormProps>;
export const PhoneExpired: Story = { name: 'Phone-FR-Expired', args: EXPIRED_ARGS };
export const DeskExpired: Story = { name: 'Desk-FR-Expired', globals: { surface: 'desktop' }, args: EXPIRED_ARGS, render: desk };
export const ExpiredSamePrice: Story = {
  name: 'expired — та сама ціна',
  args: { notice: { ...EXPIRED, priceChanged: false, price: 4.99 } },
};

export const HoldBoard: Story = { name: 'hold-board — табло утримання', args: { holdBoard: { remainingMs: 118_000, totalMin: 10 } } };
export const HoldWarning: Story = {
  name: 'hold-warning — «Ще 2 хвилини»',
  args: { holdBoard: { remainingMs: 118_000, totalMin: 10 }, holdWarning: { canExtend: true }, announce: 'Місце тримаємо ще 1 хвилину' },
};
export const HoldWarningNoExtend: Story = {
  name: 'hold-warning — продовжувати вже не можна',
  args: { holdBoard: { remainingMs: 90_000, totalMin: 10 }, holdWarning: { canExtend: false } },
};
export const HoldExtended: Story = {
  name: 'hold-extended — продовжили',
  args: { holdBoard: { remainingMs: 410_000, totalMin: 10 }, extendedUntil: NOW + 15 * 60_000 },
};

export const PriceChanged: Story = {
  name: 'price-changed',
  args: {
    freeCount: 3,
    view: view({ freeCount: 3, price: { ...view().price, current: 7.99, tier: 'last3' }, priceChanged: { from: 4.99, to: 7.99 } }),
    payPrice: 7.99,
  },
};
export const Last3: Story = {
  name: 'last3 — без підказки про ціну',
  args: { freeCount: 3, view: view({ freeCount: 3, state: 'last3', price: { ...view().price, current: 7.99, tier: 'last3' } }), payPrice: 7.99 },
};
export const PassDiscount: Story = {
  name: 'pass-discount — −50% з пасом',
  args: {
    giftPass: false,
    onLoginForPass: undefined,
    view: view({}, true),
    payPrice: 2.49,
  },
};
export const NoLoginLine: Story = { name: 'без рядка «Увійди»', args: { onLoginForPass: undefined } };

export const EmailError: Story = { name: 'email error', args: { values: { ...VALUES, email: 'olena@' }, errors: { email: 'email' } } };
export const NameError: Story = { name: 'name error', args: { values: { ...VALUES, name: '' }, errors: { name: 'name' } } };
export const ModerationError: Story = {
  name: 'moderation error',
  args: { values: { ...VALUES, greeting: 'Заходь на t.me/spam' }, errors: { greeting: 'moderation' } },
};
export const Submitting: Story = { name: 'submitting — перехід до оплати', args: { submitting: true } };
