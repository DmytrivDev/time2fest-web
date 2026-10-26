import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import { EventCard } from '@/components/live/EventCard';
import { Stage, StateRow } from '../_support/Stage';
import { AZORES, CAPE_VERDE, LONDON, PARIS, RIO, sceneTime } from '../_support/liveFixtures';

const meta = {
  title: 'Живий ефір/EventCard',
  component: EventCard,
  parameters: { time: sceneTime },
  args: { ...AZORES, status: 'soon' },
} satisfies Meta<typeof EventCard>;
export default meta;
type Story = StoryObj<typeof meta>;

function Toggleable(props: Parameters<typeof EventCard>[0]) {
  const [inSchedule, setIn] = useState(props.inSchedule ?? false);
  return <EventCard {...props} inSchedule={inSchedule} onToggleSchedule={(_id, next) => setIn(next)} />;
}

export const States: Story = {
  name: 'Стани: d · наживо · минула · у графіку',
  render: () => (
    <Stage>
      <StateRow label="d — скоро, трансляція очікується (кнопка графіка інертна: обробника немає)">
        <EventCard {...AZORES} status="soon" />
      </StateRow>
      <StateRow label="наживо — коралова лінія ліворуч, «В ефірі», «Наживо» (без пульсу під «зменшити рух»)">
        <EventCard {...LONDON} status="live" onToggleSchedule={() => undefined} />
      </StateRow>
      <StateRow label="p — минула: сірий текст, «північ була … тому», кнопка неактивна з причиною в назві">
        <EventCard {...PARIS} status="recording" onToggleSchedule={() => undefined} />
        <EventCard {...PARIS} status="ended" onToggleSchedule={() => undefined} />
      </StateRow>
      <StateRow label="у графіку + ваша північ — друга позначка, висота росте">
        <EventCard {...AZORES} status="soon" inSchedule isOwnMidnight onToggleSchedule={() => undefined} />
      </StateRow>
    </Stage>
  ),
};

export const StreamStatuses: Story = {
  name: 'Статус трансляції: наживо · очікується · можлива · лише відлік',
  render: () => (
    <Stage>
      <StateRow label="тип святкування кольором text, решта — text-secondary">
        <EventCard {...LONDON} status="soon" stream="live" onToggleSchedule={() => undefined} />
        <EventCard {...AZORES} status="soon" stream="expected" onToggleSchedule={() => undefined} />
        <EventCard {...RIO} status="soon" onToggleSchedule={() => undefined} />
        <EventCard {...CAPE_VERDE} status="soon" onToggleSchedule={() => undefined} />
      </StateRow>
    </Stage>
  ),
};

export const ScheduleToggle: Story = {
  name: 'Кнопка графіка: працює, коли є обробник',
  render: () => (
    <Stage>
      <Toggleable {...AZORES} status="soon" />
    </Stage>
  ),
};

export const Focus: Story = {
  name: 'f — фокус клавіатури (посилання, потім кнопка графіка)',
  render: () => (
    <Stage>
      <EventCard {...AZORES} status="soon" onToggleSchedule={() => undefined} />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const LongTitle: Story = {
  name: 'Довга назва — обрізається з трьома крапками',
  render: () => (
    <Stage>
      <EventCard {...AZORES} title="Лос-Анджелес · Сан-Франциско · Сіетл" status="soon" onToggleSchedule={() => undefined} />
    </Stage>
  ),
};

export const Stack: Story = {
  name: 'Телефон: на всю ширину',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <EventCard {...LONDON} status="live" layout="stack" onToggleSchedule={() => undefined} />
      <EventCard {...AZORES} status="soon" layout="stack" onToggleSchedule={() => undefined} />
    </Stage>
  ),
};
