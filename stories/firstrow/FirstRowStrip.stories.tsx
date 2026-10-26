import type { Meta, StoryObj } from '@storybook/nextjs';
import { FirstRowChatRow, FirstRowStrip } from '@/components/firstrow/FirstRowStrip';
import { Stage } from '../_support/Stage';
import { countryName, makeView, MIDNIGHT, RESTRAINED_NOTE } from './fixtures';

const noop = () => undefined;

const meta = {
  title: 'Перший ряд/FirstRowStrip',
  component: FirstRowStrip,
  globals: { surface: 'desktop' },
  args: {
    city: 'Лондон',
    midnightMs: MIDNIGHT,
    takeVariant: 'coral',
    onTake: noop,
    onInfo: noop,
    onOpenEmoji: noop,
    onOpenTicket: noop,
    countryName,
    ...makeView({ taken: 8 }),
  },
  render: (args) => (
    <Stage>
      <FirstRowStrip {...args} />
    </Stage>
  ),
} satisfies Meta<typeof FirstRowStrip>;
export default meta;
type Story = StoryObj<typeof meta>;

const phoneArgs = { layout: 'compact', takeVariant: 'tonal' } as const;
const phoneGlobals = { surface: 'phone' } as const;
const nextSale = { city: 'Азорські острови', midnightMs: MIDNIGHT + 3_600_000 };

export const DeskEmpty: Story = { name: 'Desk-FR-States — empty', args: makeView({ taken: 0 }) };
export const DeskOpen: Story = { name: 'Desk-FR-States — open', args: makeView({ taken: 4 }) };
export const DeskLast3: Story = { name: 'Desk-FR-States — last3', args: makeView({ taken: 8 }) };
export const DeskSoldout: Story = {
  name: 'Desk-FR-States — soldout',
  args: { ...makeView({ taken: 10 }), soldOutAlt: { city: 'Ріо-де-Жанейро', href: '#' } },
};
export const DeskClosed: Story = {
  name: 'Desk-FR-States — closed + nextSale',
  args: { ...makeView({ taken: 8, closed: true }), nextSale: { ...nextSale, href: '#' } },
};
export const DeskMine: Story = { name: 'Desk-FR-States — mine', args: makeView({ taken: 8, mine: 3 }) };
export const DeskRestrained: Story = {
  name: 'Desk-FR-States — restrained',
  args: { ...makeView({ taken: 5, restrained: true }), restrainedNote: RESTRAINED_NOTE },
};
export const DeskPassDiscount: Story = { name: 'Desk-FR-States — pass-discount', args: makeView({ taken: 8, pass: true }) };
export const DeskInfoOpen: Story = { name: 'Desk-FR-Info — кнопка «Що входить» розгорнута', args: { ...makeView({ taken: 6 }), infoOpen: true } };

export const PhoneEmpty: Story = { name: 'Phone-FR-States — empty', globals: phoneGlobals, args: { ...phoneArgs, ...makeView({ taken: 0 }) } };
export const PhoneOpen: Story = { name: 'Phone-FR-States — open', globals: phoneGlobals, args: { ...phoneArgs, ...makeView({ taken: 4 }) } };
export const PhoneLast3: Story = { name: 'Phone-FR-States — last3', globals: phoneGlobals, args: { ...phoneArgs, ...makeView({ taken: 8 }) } };
export const PhoneSoldout: Story = {
  name: 'Phone-FR-States — soldout',
  globals: phoneGlobals,
  args: { ...phoneArgs, ...makeView({ taken: 10 }), soldOutAlt: { city: 'Ріо-де-Жанейро' } },
};
export const PhoneClosed: Story = {
  name: 'Phone-FR-States — closed + nextSale',
  globals: phoneGlobals,
  args: { ...phoneArgs, ...makeView({ taken: 8, closed: true }), nextSale },
};
export const PhoneMine: Story = { name: 'Phone-FR-States — mine', globals: phoneGlobals, args: { ...phoneArgs, ...makeView({ taken: 8, mine: 3 }) } };
export const PhoneRestrained: Story = {
  name: 'Phone-FR-States — restrained',
  globals: phoneGlobals,
  args: { ...phoneArgs, ...makeView({ taken: 5, restrained: true }), restrainedNote: RESTRAINED_NOTE },
};
export const PhonePassDiscount: Story = {
  name: 'Phone-FR-States — pass-discount',
  globals: phoneGlobals,
  args: { ...phoneArgs, ...makeView({ taken: 8, pass: true }) },
};

export const ChatRow: Story = {
  name: 'Phone-Chat — згорнутий рядок «Перший ряд · Лондон · 8 ›»',
  globals: phoneGlobals,
  render: () => (
    <Stage>
      <FirstRowChatRow city="Лондон" freeCount={8} onClick={noop} />
    </Stage>
  ),
};
