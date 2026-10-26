import type { Meta, StoryObj } from '@storybook/nextjs';
import { FirstRowWall, type FirstRowWallProps } from '@/components/live/FirstRowWall';
import { SeatPill } from '@/components/live/SeatPill';
import { Stage, StateRow } from '../_support/Stage';
import { PendingIntl } from '../us1/PendingIntl';
import { MIDNIGHT, countryName, fullSeats, londonSeats, seatsWithMine } from '../us1/fixtures';

const meta = {
  title: 'Перший ряд/FirstRowWall',
  component: FirstRowWall,
  globals: { surface: 'phone' },
  args: { city: 'Лондон', seats: londonSeats(), freeCount: 1, phase: 'idle', countryName },
  decorators: [
    (Story) => (
      <PendingIntl>
        <Stage>
          <Story />
        </Stage>
      </PendingIntl>
    ),
  ],
} satisfies Meta<typeof FirstRowWall>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = { name: 'idle — Phone-Home-Live (до півночі)' };

export const Lighting: Story = {
  name: 'lighting — місця загоряються по черзі 1…10 (по 2 на секунду)',
  args: { phase: 'lighting', lightingFrom: MIDNIGHT + 15_000, seats: fullSeats(), freeCount: 0 },
  // 00:00:15 — ровно початок загоряння; секунди тікають далі.
  parameters: { time: { at: '2027-01-01T00:00:15Z' } },
};

export const Lit: Story = {
  name: 'lit — «З Новим роком, перший ряд!» (9 із 10 місць)',
  args: { phase: 'lit' },
};

export const LitFull: Story = {
  name: 'lit — Phone-Moment: усі 10 місць, сітка 2 колонки',
  args: { phase: 'lit', seats: fullSeats(), freeCount: 0, layout: 'grid' },
};

export const LitFullCarousel: Story = {
  name: 'lit — усі 10 місць, карусель (десктоп)',
  globals: { surface: 'desktop' },
  args: { phase: 'lit', seats: fullSeats(), freeCount: 0 },
};

export const Mine: Story = {
  name: 'своє місце — межа text і «Ти» (дотик відкриває O-EMOJI)',
  args: { phase: 'idle', seats: seatsWithMine(), onOpenEmoji: () => undefined },
};

export const MineLit: Story = {
  name: 'своє місце після півночі',
  args: { phase: 'lit', seats: seatsWithMine() },
};

export const Restrained: Story = {
  name: 'restrained — без руху й без привітання',
  args: { phase: 'lit', restrained: true },
};

export const ReducedMotion: Story = {
  name: 'зменшити рух — lighting одразу стає lit, місця просто з’являються',
  globals: { reduceMotion: 'on' },
  args: { phase: 'lighting', lightingFrom: MIDNIGHT + 15_000, seats: fullSeats(), freeCount: 0 },
  parameters: { time: { at: '2027-01-01T00:00:15Z' } },
};

export const AllFree: Story = {
  name: 'усі місця вільні',
  args: { seats: [], freeCount: 10 },
};

export const SoldOut: Story = {
  name: 'розпродано: вільних немає',
  args: { seats: fullSeats(), freeCount: 0 },
};

function Wall(args: FirstRowWallProps) {
  return <FirstRowWall {...args} />;
}
export const Desktop: Story = {
  name: 'десктоп — карусель зі стрілками «Попередні / Наступні»',
  globals: { surface: 'desktop' },
  args: { phase: 'idle', city: 'Лондон' },
  render: (args) => <Wall {...args} />,
};

export const Pills: Story = {
  name: 'SeatPill — стани',
  render: () => (
    <>
      <StateRow label="idle · lit">
        <SeatPill seat={1} participant={{ name: 'Олена і друзі', flagCode: 'UA', emojiId: 'glasses' }} countryName="Україна" />
        <SeatPill seat={1} participant={{ name: 'Олена і друзі', flagCode: 'UA', emojiId: 'glasses' }} countryName="Україна" state="lit" />
      </StateRow>
      <StateRow label="своє: idle · lit">
        <SeatPill seat={4} participant={{ name: 'Мирон', flagCode: 'UA', emojiId: 'fireworks', isMine: true }} countryName="Україна" />
        <SeatPill seat={4} participant={{ name: 'Мирон', flagCode: 'UA', emojiId: 'fireworks', isMine: true }} countryName="Україна" state="lit" />
      </StateRow>
      <StateRow label="довге ім’я · невідома емоція">
        <SeatPill seat={6} participant={{ name: 'Богдан з родиною та друзями', flagCode: 'UA', emojiId: 'unknown-id' }} />
      </StateRow>
    </>
  ),
};
