import type { Meta, StoryObj } from '@storybook/nextjs';
import { QRCode } from '@/components/primitives/QRCode';
import { Stage, StateRow } from '../_support/Stage';

const meta = {
  title: 'Примітиви/QRCode',
  component: QRCode,
  args: {
    value: 'https://time2fest.com/r/ab12',
    shortUrl: 'time2fest.com/r/ab12',
    alt: 'QR-код: оцінити шоу на телефоні',
  },
} satisfies Meta<typeof QRCode>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Stage>
      <StateRow label="з видимою короткою адресою; alt називає, куди веде">
        <QRCode
          value="https://time2fest.com/r/ab12"
          shortUrl="time2fest.com/r/ab12"
          alt="QR-код: оцінити шоу на телефоні"
        />
      </StateRow>
    </Stage>
  ),
};

export const Tv: Story = {
  name: 'ТВ — більший код і підпис',
  globals: { surface: 'tv' },
  render: () => (
    <Stage>
      <QRCode
        tv
        size={256}
        value="https://time2fest.com/r/dubai"
        shortUrl="time2fest.com/r/dubai"
        alt="QR-код: зайняти місце в першому ряду на телефоні"
      />
    </Stage>
  ),
};
