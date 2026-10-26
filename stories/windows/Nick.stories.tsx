import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { Nick } from '@/components/windows/Nick';
import countriesJson from '@/data/countries.json';
import type { CountriesFile } from '@/lib/data/types';
import { Stage } from '../_support/Stage';

const flags = (countriesJson as unknown as CountriesFile).countries.map((c) => ({ code: c.flagCode, name: c.name.uk }));

const meta = {
  title: 'Вікна/Nick',
  component: Nick,
  globals: { surface: 'phone' },
  args: { flags, detectedFlag: 'CA', takenNicks: ['Аміра', 'Karim'], onDone: () => undefined },
  render: (args) => (
    <Stage>
      <div className="rounded-lg border border-border bg-surface p-4">
        <h2 className="pb-3 text-headline-sm">Як тебе підписати в чаті?</h2>
        <Nick {...args} />
      </div>
    </Stage>
  ),
} satisfies Meta<typeof Nick>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: 'Phone-Nick — прапор за розташуванням, прев’ю, coral «Готово»', args: { initialNick: 'Аміра2' } };

export const Desktop: Story = { name: 'Desk-Nick', globals: { surface: 'desktop' }, args: { initialNick: 'Мирон' } };

export const Empty: Story = { name: 'порожньо — «Готово» показує причину', args: {} };

export const Taken: Story = { name: 'нік зайнятий', args: { initialNick: 'Аміра' } };

export const Forbidden: Story = { name: 'нік заборонений', args: { initialNick: 'Time2Fest-admin' } };

export const Undetected: Story = {
  name: 'прапор не визначено — Земля «Без країни», пошук відкрито',
  args: { detectedFlag: undefined, initialNick: 'Мирон' },
};

export const TooShortThenValid: Story = {
  name: 'нік 2–20: 1 символ не проходить',
  args: {},
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: /Нік/ }), 'М');
    await userEvent.click(canvas.getByRole('button', { name: 'Готово' }));
    await expect(canvas.getByText(/від 2 до 20 символів/)).toBeInTheDocument();
  },
};
