import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent, within } from 'storybook/test';
import { CountryList } from '@/components/live/CountryList';
import type { ZoneMapGeometry } from '@/components/live/MapModel';
import geometryJson from '@/data/zonemap.json';
import { sceneTime } from '../_support/liveFixtures';

const geometry = geometryJson as unknown as ZoneMapGeometry;

const meta = {
  title: 'Сторінки/Країни й міста',
  component: CountryList,
  // «Зараз» = 23:50 UTC 31 грудня: UTC+0 «наживо», UTC−1 «далі», Європа вже зустріла.
  parameters: { time: sceneTime },
  args: { geometry },
} satisfies Meta<typeof CountryList>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = {
  name: 'Телефон: усі пояси згорнуті',
  globals: { surface: 'phone' },
};

export const PhoneOpenZone: Story = {
  name: 'Телефон: розгорнуто пояс наживо — картки країн за регіонами',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    const row = canvasElement.querySelector<HTMLButtonElement>('[data-zone-row] > button');
    if (row) await userEvent.click(row);
  },
};

export const PhoneMap: Story = {
  name: 'Телефон: перемикач «Мапа»',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Мапа' }));
  },
};

export const Desktop: Story = {
  name: 'Десктоп: рядки поясів, «Питання й відповіді» у дві колонки',
  globals: { surface: 'desktop' },
};

export const StreamsOnly: Story = {
  name: '«З трансляціями»: лише пояси й країни з трансляціями',
  globals: { surface: 'desktop' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('radio', { name: 'З трансляціями' }));
  },
};

export const SearchFound: Story = {
  name: 'Пошук «Бразил»: пояси з Бразилією, розгорнуті',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('searchbox', { name: 'Знайти країну чи місто' }), 'Бразил');
  },
};

export const SearchEmpty: Story = {
  name: 'e — пошук без результатів',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('searchbox', { name: 'Знайти країну чи місто' }), 'Атлантида');
  },
};
