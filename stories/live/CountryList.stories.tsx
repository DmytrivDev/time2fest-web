import type { Meta, StoryObj } from '@storybook/nextjs';
import { screen, userEvent, within } from 'storybook/test';
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
  name: 'Телефон: список — «Зараз наживо», «Далі», згорнуті «Ще попереду» й «Уже зустріли»',
  globals: { surface: 'phone' },
};

export const PhoneMap: Story = {
  name: 'Телефон: перемикач «Мапа»',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Мапа' }));
  },
};

export const PhoneFilters: Story = {
  name: 'Телефон: фільтри відкриті («Показати N країн», «Скинути»)',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Фільтри' }));
  },
};

export const PhoneQuickSet: Story = {
  name: 'Телефон: швидкий набір — перемикач «Лише з трансляціями» ввімкнено',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('switch', { name: 'Лише з трансляціями' }));
  },
};

export const Desktop: Story = {
  name: 'Десктоп: список ліворуч, мапа поясів праворуч, «Питання й відповіді» у дві колонки',
  globals: { surface: 'desktop' },
};

export const SearchFound: Story = {
  name: 'Пошук «Бра»: Бразилія в UTC−3 (група розкрита)',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('searchbox', { name: 'Знайти країну чи місто' }), 'Бра');
  },
};

export const SearchEmpty: Story = {
  name: 'e — пошук без результатів',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('searchbox', { name: 'Знайти країну чи місто' }), 'Атлантида');
  },
};

export const NoStatuses: Story = {
  name: '0 статусів: «Показати 0 країн» неактивна + «Обери хоча б один статус»',
  globals: { surface: 'phone' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Фільтри' }));
    const dialog = await screen.findByRole('dialog', { name: 'Фільтри' });
    for (const name of [/^Наживо/, /^Трансляція очікується/, /^Трансляція можлива/, /^Лише відлік/]) {
      await userEvent.click(within(dialog).getByRole('checkbox', { name }));
    }
  },
};
