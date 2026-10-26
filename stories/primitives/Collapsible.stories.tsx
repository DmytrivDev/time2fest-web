import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Accordion } from '@/components/primitives/Accordion';
import { Collapsible } from '@/components/primitives/Collapsible';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/Collapsible і Accordion',
  component: Collapsible,
  args: { title: 'Ще 14 країн поясу', children: 'Вміст' },
} satisfies Meta<typeof Collapsible>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsibleStates: Story = {
  render: () => (
    <Stage className="max-w-96">
      <StateRow label="d (згорнуто) · o (розгорнуто) · x">
        <div className="flex w-full flex-col gap-3">
          <Collapsible title="Ще 14 країн поясу" meta="14">Франція, Німеччина, Італія, Іспанія…</Collapsible>
          <Collapsible title="Уже зустріли" defaultOpen meta="5">Нова Зеландія, Фіджі, Австралія…</Collapsible>
          <Collapsible title="Трансляції в цьому поясі" disabled>Недоступно</Collapsible>
        </div>
      </StateRow>
    </Stage>
  ),
};

export const AccordionSingle: Story = {
  name: 'Accordion — «Питання й відповіді» (один відкритий)',
  render: () => (
    <Stage className="max-w-96">
      <Accordion
        items={[
          { value: 'first', title: 'Яка країна першою зустрічає Новий рік?', content: 'Кірібаті — острови Лайн.' },
          { value: 'free', title: 'Перегляд справді безплатний?', content: 'Так, перегляд і чат завжди безплатні.' },
        ]}
        defaultValue="first"
      />
    </Stage>
  ),
};

export const AccordionMultiple: Story = {
  name: 'Accordion — «Весь шлях» (кілька відкритих)',
  render: () => (
    <Stage className="max-w-96">
      <Accordion
        type="multiple"
        headingLevel={3}
        defaultValue={['a']}
        items={[
          { value: 'a', title: 'Нова Зеландія · Окленд', content: 'Північ о 13:00 за вашим часом.' },
          { value: 'b', title: 'Австралія · Сідней', content: 'Північ о 14:00 за вашим часом.' },
        ]}
      />
    </Stage>
  ),
};

export const Focus: Story = {
  render: () => (
    <Stage className="max-w-96">
      <Collapsible title="Ще 14 країн поясу">Вміст</Collapsible>
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
