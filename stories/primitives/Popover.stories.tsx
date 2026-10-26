import type { Meta, StoryObj } from '@storybook/nextjs';
import { Button } from '@/components/primitives/Button';
import { IconButton } from '@/components/primitives/IconButton';
import { Popover, PopoverClose, PopoverContent, PopoverTrigger } from '@/components/primitives/Popover';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Popover', component: Popover } satisfies Meta<typeof Popover>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {
  name: 'd — закритий (aria-expanded=false)',
  render: () => (
    <Stage>
      <Popover>
        <PopoverTrigger asChild>
          <Button variant="secondary" iconRight="chevron-down">Країна: Франція</Button>
        </PopoverTrigger>
        <PopoverContent>Вибір країни чату</PopoverContent>
      </Popover>
    </Stage>
  ),
};

export const Open: Story = {
  name: 'o — відкритий (Esc закриває й повертає фокус)',
  render: () => (
    <Stage className="min-h-72">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <IconButton icon="plus" variant="ring" aria-label="Додати трансляцію" />
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <p className="text-body-strong">Додати в кімнату</p>
          <p className="mt-1 text-body text-text-secondary">Лондон · Біг-Бен</p>
          <PopoverClose asChild>
            <Button variant="tonal" className="mt-3">Додати</Button>
          </PopoverClose>
        </PopoverContent>
      </Popover>
    </Stage>
  ),
};

export const HowToCelebrate: Story = {
  name: '«Як святкувати» на мапі — немодальна панель',
  render: () => (
    <Stage className="min-h-72">
      <Popover defaultOpen>
        <PopoverTrigger asChild>
          <Button variant="secondary">Як святкувати</Button>
        </PopoverTrigger>
        <PopoverContent className="w-72">
          <ul className="list-disc ps-5 text-body-lg">
            <li>Феєрверки над рікою</li>
            <li>Дванадцять ударів дзвону</li>
          </ul>
        </PopoverContent>
      </Popover>
    </Stage>
  ),
};
