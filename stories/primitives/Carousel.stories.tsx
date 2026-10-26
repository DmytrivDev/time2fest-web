import type { Meta, StoryObj } from '@storybook/nextjs';
import { Badge } from '@/components/primitives/Badge';
import { Carousel } from '@/components/primitives/Carousel';
import { Flag } from '@/components/primitives/Flag';
import { Stage } from '../_support/Stage';

const meta = { title: 'Примітиви/Carousel', component: Carousel, args: { label: 'Зараз і далі', children: null } } satisfies Meta<typeof Carousel>;
export default meta;
type Story = StoryObj<typeof meta>;

const CITIES = [
  { flag: 'NZ', city: 'Окленд', time: '13:00' },
  { flag: 'AU', city: 'Сідней', time: '14:00' },
  { flag: 'JP', city: 'Токіо', time: '16:00' },
  { flag: 'AE', city: 'Дубай', time: '22:00' },
  { flag: 'FR', city: 'Париж', time: '02:00' },
  { flag: 'GB', city: 'Лондон', time: '03:00' },
];

function Card({ flag, city, time }: { flag: string; city: string; time: string }) {
  return (
    <div className="flex h-36 w-60 flex-col justify-between rounded-lg bg-surface p-4">
      <Flag code={flag} size="md" decorative />
      <div>
        <p className="text-headline-sm text-text">{city}</p>
        <p className="text-caption text-text-muted">північ о {time} за вашим часом</p>
      </div>
    </div>
  );
}

export const Manual: Story = {
  name: 'Вручну: стрілка лише з боку непройдених елементів',
  globals: { surface: 'phone' },
  render: () => (
    <Stage>
      <Carousel label="Зараз і далі">
        {CITIES.map((c) => (
          <Card key={c.city} {...c} />
        ))}
      </Carousel>
    </Stage>
  ),
};

export const Wall: Story = {
  name: 'Стіна «Першого ряду»: автогортання по колу, пауза на наведенні й фокусі',
  render: () => (
    <Stage>
      <Carousel label="Перший ряд · Лондон" autoplay autoplayDelay={3000} showPause>
        {CITIES.map((c) => (
          <div key={c.city} className="flex h-16 w-48 items-center gap-3 rounded-md bg-surface-raised px-3">
            <Flag code={c.flag} size="sm" decorative />
            <span className="text-body-strong text-text">{c.city}</span>
            <Badge variant="first-row" />
          </div>
        ))}
      </Carousel>
    </Stage>
  ),
};

export const WallReducedMotion: Story = {
  name: 'Стіна під «зменшити рух»: не гортається сама, кнопки «Пауза» немає',
  globals: { reduceMotion: 'on' },
  render: () => (
    <Stage>
      <Carousel label="Перший ряд · Лондон" autoplay showPause>
        {CITIES.map((c) => (
          <div key={c.city} className="flex h-16 w-48 items-center gap-3 rounded-md bg-surface-raised px-3">
            <Flag code={c.flag} size="sm" decorative />
            <span className="text-body-strong text-text">{c.city}</span>
          </div>
        ))}
      </Carousel>
    </Stage>
  ),
};
