import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { PassOffer } from '@/components/pass/PassOffer';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const NOW = Date.parse('2027-01-01T00:06:00Z');
const MIN = 60_000;
const pt = (eventId: string, flagCode: string, city: string, midnightMs: number) => ({ eventId, flagCode, city, midnightMs });
const MET = [pt('evt_paris_2027', 'FR', 'Париж', NOW - 66 * MIN), pt('evt_london_2027', 'GB', 'Лондон', NOW - 6 * MIN)];
const NEXT = [pt('evt_azores_2027', 'PT', 'Азорські острови', NOW + 54 * MIN), pt('cv', 'CV', 'Прая', NOW + 55 * MIN), pt('br', 'BR', 'Ріо-де-Жанейро', NOW + 174 * MIN)];

const meta = {
  title: 'Вікна/PassOffer',
  component: PassOffer,
  globals: { surface: 'phone' },
  args: { count: 2, met: MET, next: NEXT, now: NOW, onClose: () => undefined, onDetails: () => undefined },
  decorators: [
    (Story) => (
      <CoralProvider>
        <Stage>
          <Story />
        </Stage>
      </CoralProvider>
    ),
  ],
} satisfies Meta<typeof PassOffer>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Phone: Story = { name: '«Наступна північ» — телефон' };

export const Desktop: Story = { name: '«Наступна північ» — десктоп', globals: { surface: 'desktop' } };

export const LongNight: Story = {
  name: 'довга ніч — 4 Нових роки',
  args: { count: 4, met: [pt('jp', 'JP', 'Токіо', NOW - 546 * MIN), pt('ae', 'AE', 'Дубай', NOW - 246 * MIN), ...MET] },
  globals: { surface: 'desktop' },
};

export const GetPass: Story = {
  name: '«Оформити пас · $5»',
  play: async ({ canvasElement }) => {
    const c = within(canvasElement);
    await expect(c.getByRole('button', { name: 'Оформити пас · $5' })).toBeInTheDocument();
    await userEvent.click(c.getByRole('button', { name: 'Оформити пас · $5' }));
  },
};
