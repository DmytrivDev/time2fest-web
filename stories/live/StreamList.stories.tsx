import type { Meta, StoryObj } from '@storybook/nextjs';
import { MoreStreamsSheet, StreamList, StreamRow, ZoneStreamsBlock } from '@/components/live/StreamList';
import type { StreamRowData } from '@/lib/live/countryData';
import { Stage, StateRow } from '../_support/Stage';

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
const FRANCE_EXPECTED = [LYON, NICE, row('src_lille', { title: 'Лілль · Гранд-Плас', status: 'possible', kind: 'webcam' })];
const FRANCE_RECORDINGS = FRANCE.map((r) => ({ ...r, status: 'recording' as const }));

const ZONE = [
  row('src_berlin', { title: 'Берлін · Бранденбурзькі ворота', countryIso: 'DE', flagCode: 'DE', countryName: 'Німеччина' }),
  row('src_rome', { title: 'Рим · Колізей', countryIso: 'IT', flagCode: 'IT', countryName: 'Італія', status: 'expected' }),
  row('src_madrid', { title: 'Мадрид · Пуерта-дель-Соль', countryIso: 'ES', flagCode: 'ES', countryName: 'Іспанія', kind: 'tv', celebrationType: 'tv' }),
];

const noop = () => undefined;

const meta = {
  title: 'Живий ефір/StreamList',
  component: StreamList,
  args: {
    countryName: 'Франція',
    streams: FRANCE,
    currentStreamId: PARIS.id,
    onSelect: noop,
    onAddToRoom: noop,
    timeZone: 'Europe/Kyiv',
  },
} satisfies Meta<typeof StreamList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const WithCurrent: Story = {
  name: 'Поточна трансляція з «−», решта з «+»',
  render: (args) => (
    <Stage>
      <StreamList {...args} />
    </Stage>
  ),
};

export const Expected: Story = {
  name: 'Очікується й можлива',
  render: (args) => (
    <Stage>
      <StreamList {...args} streams={FRANCE_EXPECTED} currentStreamId={null} />
    </Stage>
  ),
};

export const Recordings: Story = {
  name: 'Усі записи: «Записи · Франція»',
  render: (args) => (
    <Stage>
      <StreamList {...args} streams={FRANCE_RECORDINGS} currentStreamId={null} />
    </Stage>
  ),
};

export const ZoneExpanded: Story = {
  name: 'Трансляції в цьому поясі: розгорнуто',
  render: (args) => (
    <Stage>
      <ZoneStreamsBlock streams={ZONE} currentStreamId={null} midnightMs={MIDNIGHT} onSelect={args.onSelect} onAddToRoom={noop} timeZone="Europe/Kyiv" />
    </Stage>
  ),
};

export const ZoneCollapsed: Story = {
  name: 'Трансляції в цьому поясі: згорнуто (зберігається)',
  render: (args) => {
    // Стан тримає гостьове сховище: тут лише показуємо, що кнопка перемикає блок.
    return (
      <Stage>
        <StateRow label="Натисніть «Згорнути» — вибір запам’ятається">
          <div className="w-full">
            <ZoneStreamsBlock streams={ZONE} currentStreamId={null} midnightMs={MIDNIGHT} onSelect={args.onSelect} timeZone="Europe/Kyiv" />
          </div>
        </StateRow>
      </Stage>
    );
  },
};

export const PlusMenuOpen: Story = {
  name: 'Меню «+»: заміна й нове вікно (десктоп)',
  globals: { surface: 'desktop' },
  render: (args) => (
    <Stage>
      <div className="min-h-64 max-w-xl">
        <StreamList {...args} />
      </div>
    </Stage>
  ),
};

export const PlusConfirmPhone: Story = {
  name: 'Підтвердження «+» під рядком (телефон)',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <StateRow label="Торкніться «+» біля Ліона">
        <div className="w-full">
          <StreamRow row={LYON} current={false} onSelect={args.onSelect} onAddToRoom={noop} timeZone="Europe/Kyiv" currentTitle={PARIS.title} />
        </div>
      </StateRow>
    </Stage>
  ),
};

export const MoreStreams: Story = {
  name: 'Аркуш «Трансляції о 01:00» (телефон)',
  globals: { surface: 'phone' },
  render: (args) => (
    <Stage>
      <MoreStreamsSheet
        countryName="Франція"
        countryStreams={FRANCE}
        zoneStreams={ZONE}
        midnightMs={MIDNIGHT}
        currentStreamId={PARIS.id}
        onSelect={args.onSelect}
        onAddToRoom={noop}
        timeZone="Europe/Kyiv"
      />
    </Stage>
  ),
};
