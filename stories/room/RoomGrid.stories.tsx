import type { Meta, StoryObj } from '@storybook/nextjs';
import type { ReactNode } from 'react';
import { ResumeCard, RoomGrid, type RoomGridProps, type RoomWindowView } from '@/components/room/RoomGrid';
import { Stage } from '../_support/Stage';

function WithRoomMessages({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

const noop = () => undefined;

function win(slot: number, title: string, over: Partial<RoomWindowView> = {}): RoomWindowView {
  return { slot, title, city: title.split(' · ')[0] ?? title, status: 'live', hasSound: false, ...over };
}

const PARIS = win(1, 'Париж · Ейфелева вежа', { hasSound: true, inSchedule: true });
const LONDON = win(2, 'Лондон · Біг-Бен', { stamped: true });
const BERLIN = win(3, 'Берлін · Бранденбурзькі ворота', { status: 'expected' });
const ROME = win(4, 'Рим · Колізей', { status: 'possible' });

function Placeholder() {
  return <div className="aspect-video w-full min-h-player-min-height bg-surface-raised" />;
}

const renderMedia: RoomGridProps['renderMedia'] = () => <Placeholder />;

const meta = {
  title: 'Кімната/RoomGrid',
  component: RoomGrid,
  args: {
    layout: 'desktop',
    countryName: 'Франція',
    countryHref: '/fr',
    windows: [PARIS],
    limit: 4,
    pickTarget: null,
    countdown: 'до півночі 00:02:00',
    renderMedia,
    onAdd: noop,
    onRemove: noop,
    onSound: noop,
    onReplace: noop,
    onCancelPick: noop,
    soundStatus: 'Звук у вікні «Париж»',
  },
} satisfies Meta<typeof RoomGrid>;
export default meta;
type Story = StoryObj<typeof meta>;

function room(args: RoomGridProps) {
  return (
    <WithRoomMessages>
      <Stage>
        <RoomGrid {...args} />
      </Stage>
    </WithRoomMessages>
  );
}

export const Desktop1: Story = { name: 'Десктоп: 1 вікно', globals: { surface: 'desktop' }, render: room };

export const Desktop2: Story = {
  name: 'Десктоп: 2 вікна',
  globals: { surface: 'desktop' },
  args: { windows: [PARIS, LONDON] },
  render: room,
};

export const Desktop3: Story = {
  name: 'Десктоп: 3 вікна (2×2 з вільною клітинкою)',
  globals: { surface: 'desktop' },
  args: { windows: [PARIS, LONDON, BERLIN] },
  render: room,
};

export const Desktop4: Story = {
  name: 'Десктоп: 4 вікна',
  globals: { surface: 'desktop' },
  args: { windows: [PARIS, LONDON, BERLIN, ROME] },
  render: room,
};

export const DesktopPick: Story = {
  name: 'Десктоп: кімната повна, вибір вікна для заміни',
  globals: { surface: 'desktop' },
  args: { windows: [PARIS, LONDON, BERLIN, ROME], pickTarget: { title: 'Амстердам · Вебкамера' } },
  render: room,
};

export const DesktopResume: Story = {
  name: 'Десктоп: збережене вікно (ResumeCard)',
  globals: { surface: 'desktop' },
  args: {
    windows: [PARIS, LONDON],
    renderMedia: (slot: number) =>
      slot === 2 ? <ResumeCard title="Лондон · Біг-Бен" onActivate={noop} /> : <Placeholder />,
  },
  render: room,
};

export const Phone1: Story = {
  name: 'Телефон: 1 вікно',
  globals: { surface: 'phone' },
  args: { layout: 'phone', limit: 2, windows: [PARIS], countdown: undefined, soundStatus: undefined },
  render: room,
};

export const Phone2: Story = {
  name: 'Телефон: 2 вікна',
  globals: { surface: 'phone' },
  args: { layout: 'phone', limit: 2, windows: [PARIS, LONDON], countdown: undefined, soundStatus: undefined },
  render: room,
};

export const PhonePick: Story = {
  name: 'Телефон: повна кімната, прибери одне',
  globals: { surface: 'phone' },
  args: {
    layout: 'phone',
    limit: 2,
    windows: [PARIS, LONDON],
    pickTarget: { title: 'Амстердам · Вебкамера' },
    countdown: undefined,
    soundStatus: undefined,
  },
  render: room,
};
