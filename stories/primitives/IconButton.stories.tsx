import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { userEvent } from 'storybook/test';
import { IconButton, IconLink } from '@/components/primitives/IconButton';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/IconButton',
  component: IconButton,
  args: { icon: 'menu', 'aria-label': 'Меню' },
} satisfies Meta<typeof IconButton>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Variants: Story = {
  render: () => (
    <Stage>
      <StateRow label="plain · ring · filled (лише звук на телефоні) · toggle">
        <IconButton icon="menu" aria-label="Меню" />
        <IconButton icon="plus" variant="ring" aria-label="Додати в кімнату" />
        <IconButton icon="minus" variant="ring" aria-label="Прибрати з кімнати" />
        <IconButton icon="speaker" variant="filled" aria-label="Увімкнути звук" />
        <IconButton icon="pause" variant="toggle" aria-label="Пауза чату" />
      </StateRow>
    </Stage>
  ),
};

export const States: Story = {
  render: () => (
    <Stage>
      <StateRow label="d · x (неактивна)">
        <IconButton icon="close" aria-label="Закрити" />
        <IconButton icon="close" aria-label="Закрити" disabled />
        <IconButton icon="minus" variant="ring" aria-label="Прибрати з кімнати" disabled />
        <IconButton icon="speaker" variant="filled" aria-label="Увімкнути звук" disabled />
      </StateRow>
      <StateRow label="s — toggle натиснуто (aria-pressed)">
        <IconButton icon="pause" variant="toggle" aria-label="Пауза чату" pressed />
        <IconButton icon="pause" variant="toggle" aria-label="Пауза чату" pressed={false} />
      </StateRow>
    </Stage>
  ),
};

export const TouchTarget: Story = {
  name: 'Зона дотику 44 при меншому колі',
  render: () => (
    <Stage>
      <StateRow label="видиме коло 32, зона дотику 44">
        <IconButton icon="close" compact aria-label="Закрити" />
        <IconButton icon="plus" variant="ring" compact aria-label="Додати в кімнату" />
      </StateRow>
    </Stage>
  ),
};

export const Tv: Story = {
  name: 'ТВ 56',
  globals: { surface: 'tv' },
  render: () => (
    <Stage>
      <StateRow label="tv">
        <IconButton icon="pause" size="tv" aria-label="Пауза" />
        <IconButton icon="speaker" size="tv" variant="ring" aria-label="Звук" />
      </StateRow>
    </Stage>
  ),
};

function ToggleDemo() {
  const [pressed, setPressed] = useState(false);
  return (
    <Stage>
      <IconButton icon="pause" variant="toggle" aria-label="Пауза чату" pressed={pressed} onPressedChange={setPressed} />
    </Stage>
  );
}
export const ToggleInteractive: Story = { render: () => <ToggleDemo /> };

export const Focus: Story = {
  render: () => (
    <Stage>
      <IconButton icon="menu" aria-label="Меню" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};

export const AsLink: Story = {
  name: 'IconLink (вхід)',
  render: () => (
    <Stage>
      <IconLink icon="user" href="#sign-in" aria-label="Увійти" iconSize={22} />
    </Stage>
  ),
};
