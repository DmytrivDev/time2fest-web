import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { AddStreamList, AddStreamPanel } from '@/components/room/AddStreamPanel';
import type { StreamRowData } from '@/lib/live/countryData';
import { Stage } from '../_support/Stage';

const MIDNIGHT = Date.parse('2027-01-01T00:00:00Z');

function row(id: string, over: Partial<StreamRowData>): StreamRowData {
  return {
    id,
    eventId: `evt_${id}`,
    countryIso: 'FR',
    flagCode: 'FR',
    countryName: 'Франція',
    title: id,
    kind: 'main',
    celebrationType: 'main',
    status: 'live',
    midnightMs: MIDNIGHT,
    href: '/fr',
    hasReplay: false,
    ...over,
  };
}

const PARIS = row('src_paris', { title: 'Париж · Ейфелева вежа' });
const LYON = row('src_lyon', { title: 'Ліон · площа Белькур', kind: 'webcam', celebrationType: 'webcam' });
const NICE = row('src_nice', { title: 'Ніцца · Англійська набережна', kind: 'webcam', celebrationType: 'webcam', status: 'expected' });
const FRANCE = [PARIS, LYON, NICE];
const ZONE = [
  row('src_berlin', { title: 'Берлін · Бранденбурзькі ворота', countryIso: 'DE', flagCode: 'DE', countryName: 'Німеччина' }),
  row('src_rome', { title: 'Рим · Колізей', countryIso: 'IT', flagCode: 'IT', countryName: 'Італія', status: 'expected' }),
  row('src_madrid', { title: 'Мадрид · Пуерта-дель-Соль', countryIso: 'ES', flagCode: 'ES', countryName: 'Іспанія', kind: 'tv', celebrationType: 'tv' }),
];

const noop = () => undefined;

const base = {
  countryName: 'Франція',
  countryStreams: FRANCE,
  zoneStreams: ZONE,
  midnightMs: MIDNIGHT,
  zoneNote: 'північ за 20 хв',
  inRoomIds: [PARIS.id],
  onPick: noop,
  timeZone: 'Europe/Kyiv',
};

const meta = {
  title: 'Кімната/AddStreamPanel',
  component: AddStreamPanel,
  args: { ...base, layout: 'desktop', open: true, onOpenChange: noop, trigger: <Button variant="tonal">Додати трансляцію</Button> },
} satisfies Meta<typeof AddStreamPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

function Controlled({ full }: { full?: boolean }) {
  const [open, setOpen] = useState(true);
  return (
    <AddStreamPanel
      {...base}
      layout="desktop"
      full={full}
      open={open}
      onOpenChange={setOpen}
      trigger={<Button variant="tonal">+ Додати трансляцію</Button>}
    />
  );
}

export const DesktopOpen: Story = {
  name: 'Десктоп: панель відкрита',
  globals: { surface: 'desktop' },
  render: () => (
    <Stage>
      <div className="min-h-screen">
        <Controlled />
      </div>
    </Stage>
  ),
};

export const DesktopRoomFull: Story = {
  name: 'Десктоп: кімната повна',
  globals: { surface: 'desktop' },
  render: () => (
    <Stage>
      <div className="min-h-screen">
        <Controlled full />
      </div>
    </Stage>
  ),
};

export const PhoneSheetContent: Story = {
  name: 'Телефон: вміст аркуша',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <AddStreamList {...base} />
    </Stage>
  ),
};
