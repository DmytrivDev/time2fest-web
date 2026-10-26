import type { Meta, StoryObj } from '@storybook/nextjs';
import { useState } from 'react';
import { Button } from '@/components/primitives/Button';
import { Menu, type MenuProps } from '@/components/shell/Menu';

const meta = {
  title: 'Оболонка/Menu',
  component: Menu,
  globals: { surface: 'phone' },
  args: { open: true, onOpenChange: () => undefined, current: 'home', pausedPlace: 'Лондон' },
} satisfies Meta<typeof Menu>;
export default meta;
type Story = StoryObj<typeof meta>;

function Demo(props: MenuProps) {
  const [open, setOpen] = useState(props.open);
  const [language, setLanguage] = useState(props.language ?? 'uk');
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>
        Меню
      </Button>
      <Menu {...props} open={open} onOpenChange={setOpen} language={language} onLanguageChange={setLanguage} />
    </>
  );
}

export const Guest: Story = {
  name: 'Гість: пауза відео, мова, пункти, «Увійти»',
  render: (args) => <Demo {...args} />,
};

export const WithPass: Story = {
  name: 'З пасом і штампами, увійшла людина',
  args: { hasPass: true, signedIn: true, stampCount: 2 },
  render: (args) => <Demo {...args} />,
};

export const Countries: Story = {
  name: 'Поточна сторінка «Країни», мова English, без паузи',
  args: { current: 'countries', language: 'en', pausedPlace: undefined },
  render: (args) => <Demo {...args} />,
};

export const ReducedMotion: Story = {
  name: '«Зменшити рух» увімкнено',
  args: { reducedMotion: true },
  render: (args) => <Demo {...args} />,
};
