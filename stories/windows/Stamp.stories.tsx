import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, userEvent, within } from 'storybook/test';
import { InFlowSlot } from '@/components/primitives/Panel';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';
import { PendingIntl } from '../us1/PendingIntl';

const SYDNEY: StampEntry = { eventId: 'evt_sydney_2027', city: 'Сідней', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const MELBOURNE: StampEntry = { eventId: 'evt_melbourne_2027', city: 'Мельбурн', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const LONDON: StampEntry = { eventId: 'evt_london_2027', city: 'Лондон', countryName: 'Велика Британія', flagCode: 'GB', illustrationId: 'gb-postcard' };
const NUUK: StampEntry = { eventId: 'evt_nuuk_2027', city: 'Нуук', countryName: 'Гренландія', flagCode: 'GL', illustrationId: 'postcard-template' };

const meta = {
  title: 'Вікна/Stamp',
  component: Stamp,
  globals: { surface: 'phone' },
  args: { stamps: [SYDNEY] },
  decorators: [
    (Story) => (
      <PendingIntl>
        <CoralProvider>
          <Stage>
            <InFlowSlot reserveHeight={120}>
              <Story />
            </InFlowSlot>
          </Stage>
        </CoralProvider>
      </PendingIntl>
    ),
  ],
} satisfies Meta<typeof Stamp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Expanded: Story = {
  name: 'expanded — Phone-Moment (гість без входу)',
};

export const Stamping: Story = {
  name: 'stamping — удар штемпеля ≈ 0,6 с і конфеті (лише у «рух увімкнено»)',
  args: { stamping: true },
  globals: { reduceMotion: 'off' },
};

export const StampingReducedMotion: Story = {
  name: 'stamping + «зменшити рух» — штемпель одразу, без конфеті',
  args: { stamping: true },
  globals: { reduceMotion: 'on' },
};

export const SignedIn: Story = {
  name: 'expanded — гість увійшов (без рядка «Збережено на цьому пристрої»)',
  args: { signedIn: true },
};

export const Multi: Story = {
  name: 'multi — «Сідней · Мельбурн»',
  args: { stamps: [SYDNEY, MELBOURNE] },
};

export const FirstRow: Story = {
  name: 'first-row — подвійна жовта рамка',
  args: { stamps: [{ ...LONDON, firstRowSeat: 4 }] },
};

export const Template: Story = {
  name: 'шаблон листівки для країни без власної',
  args: { stamps: [NUUK] },
};

export const SaveFailed: Story = {
  name: 'save-failed — «Збережемо самі, щойно з’явиться зв’язок»',
  args: { saveState: 'failed' },
};

export const Collapsed: Story = {
  name: 'collapsed — Desk-Rate (рядок з мініатюрою)',
  args: { defaultMode: 'collapsed' },
};

export const CollapsedFirstRow: Story = {
  name: 'collapsed + first-row',
  args: { defaultMode: 'collapsed', stamps: [{ ...LONDON, firstRowSeat: 4 }] },
};

export const CollapseAndExpand: Story = {
  name: '× згортає, дотик до рядка розгортає',
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Закрити' }));
    await expect(canvas.getByRole('region', { name: 'Штамп у паспорті' })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole('button', { name: /Штамп у паспорті/ }));
    await expect(canvas.getByRole('heading', { level: 2 })).toBeInTheDocument();
  },
};

export const Desktop: Story = {
  name: 'десктоп — у потоці під плеєром',
  globals: { surface: 'desktop' },
};
