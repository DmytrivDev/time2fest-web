import type { Meta, StoryObj } from '@storybook/nextjs';
import { expect, fn, userEvent, within } from 'storybook/test';
import { InFlowSlot } from '@/components/primitives/Panel';
import { Stamp, type StampEntry } from '@/components/stamp/Stamp';
import { CoralProvider } from '@/lib/overlay/coral';
import { Stage } from '../_support/Stage';

const SYDNEY: StampEntry = { eventId: 'evt_sydney_2027', city: 'Сідней', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const MELBOURNE: StampEntry = { eventId: 'evt_melbourne_2027', city: 'Мельбурн', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const NUUK: StampEntry = { eventId: 'evt_nuuk_2027', city: 'Нуук', countryName: 'Гренландія', flagCode: 'GL', illustrationId: 'postcard-template' };

const meta = {
  title: 'Вікна/Stamp',
  component: Stamp,
  globals: { surface: 'phone' },
  args: { stamps: [SYDNEY] },
  decorators: [
    (Story) => (
      <>
        <CoralProvider>
          <Stage>
            <InFlowSlot reserveHeight={120}>
              <Story />
            </InFlowSlot>
          </Stage>
        </CoralProvider>
      </>
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

export const Template: Story = {
  name: 'шаблон листівки для країни без власної',
  args: { stamps: [NUUK] },
};

export const SaveFailed: Story = {
  name: 'save-failed — «Збережемо самі, щойно з’явиться зв’язок»',
  args: { saveState: 'failed' },
};

export const Dismiss: Story = {
  name: '× прибирає штамп (рішення 2026-11-01: без згортання)',
  args: { onClose: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Прибрати штамп' }));
    await expect(args.onClose).toHaveBeenCalled();
  },
};

export const Desktop: Story = {
  name: 'десктоп — у потоці під плеєром',
  globals: { surface: 'desktop' },
};
