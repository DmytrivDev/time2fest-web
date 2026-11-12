import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/primitives/Tabs';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Tabs', component: Tabs } satisfies Meta<typeof Tabs>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Underline: Story = {
  name: 'underline — «Події | Чат» (14/600, смужка 2 px)',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <Tabs defaultValue="events">
        <TabsList aria-label="Розділи сторінки">
          <TabsTrigger value="events">Події</TabsTrigger>
          <TabsTrigger value="chat" count={7}>Чат</TabsTrigger>
        </TabsList>
        <TabsContent value="events" className="p-4 text-body text-text-secondary">Вміст «Подій»</TabsContent>
        <TabsContent value="chat" className="p-4 text-body text-text-secondary">Вміст «Чату»</TabsContent>
      </Tabs>
    </Stage>
  ),
};

export const UnderlineCounter99: Story = {
  name: 'underline — лічильник 99+',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <Tabs defaultValue="chat">
        <TabsList aria-label="Розділи кімнати">
          <TabsTrigger value="streams">Трансляції</TabsTrigger>
          <TabsTrigger value="chat" count={120}>Чат</TabsTrigger>
        </TabsList>
      </Tabs>
    </Stage>
  ),
};

export const Tv: Story = {
  name: 'tv — бічна колонка (вибране: surface-raised + смужка)',
  globals: { surface: 'tv' },
  render: () => (
    <Stage className="max-w-96">
      <Tabs variant="tv" defaultValue="next" orientation="vertical">
        <TabsList aria-label="Бічна колонка">
          <TabsTrigger value="next">Далі</TabsTrigger>
          <TabsTrigger value="howto">Як святкувати</TabsTrigger>
          <TabsTrigger value="rating">Рейтинг</TabsTrigger>
        </TabsList>
      </Tabs>
    </Stage>
  ),
};

export const Focus: Story = {
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <Tabs defaultValue="events">
        <TabsList aria-label="Розділи сторінки">
          <TabsTrigger value="events">Події</TabsTrigger>
          <TabsTrigger value="chat">Чат</TabsTrigger>
        </TabsList>
      </Tabs>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
