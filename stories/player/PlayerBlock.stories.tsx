import type { Meta, StoryObj } from '@storybook/nextjs';
import { PlayerBlock, type PlayerBlockProps, type VideoAreaKind } from '@/components/player/PlayerBlock';
import { captionPhase } from '@/lib/engine/captionPhase';
import { computeBroadcast } from '@/lib/player/BroadcastController';
import { Stage } from '../_support/Stage';

/**
 * C1 PlayerBlock (`broadcast`) за фазами підпису (таблиця C1, уточнення 2026-10-25).
 * Ефір рахується тим самим `computeBroadcast`, що й у застосунку; область відео задається пропом
 * (у Storybook немає `PlayerProvider` і хоста плеєра — на місці відео порожній слот).
 * Час глядача — Київ: «північ о 02:00 за вашим часом» для Лондона.
 */
const LONDON = Date.parse('2027-01-01T00:00:00Z');
const MIN = 60_000;

function at(offsetMs: number, extra: Partial<PlayerBlockProps> & { videoArea?: VideoAreaKind } = {}): PlayerBlockProps {
  const now = LONDON + offsetMs;
  const b = computeBroadcast(now);
  return {
    mode: 'broadcast',
    ready: true,
    phase: b.phase,
    current: b.current,
    next: b.next,
    airView: b.air?.view,
    timeZone: 'Europe/Kyiv',
    videoArea: b.air?.view === 'stream' ? 'video' : 'countdown-scene',
    ...extra,
  };
}

const iso = (offsetMs: number) => new Date(LONDON + offsetMs).toISOString();

const meta = {
  title: 'Плеєр/PlayerBlock',
  component: PlayerBlock,
  args: at(-22 * MIN - 15_000),
  parameters: { time: { at: iso(-22 * MIN - 15_000), frozen: true } },
  render: (args) => (
    <Stage>
      <div className="mx-auto flex w-full max-w-3xl flex-col">
        <PlayerBlock {...args} />
      </div>
    </Stage>
  ),
} satisfies Meta<typeof PlayerBlock>;
export default meta;
type Story = StoryObj<typeof meta>;

export const MainDesktop: Story = {
  name: 'Main — до півночі «до півночі 00:22:15» (десктоп)',
  globals: { surface: 'desktop' },
};

export const PhoneHomeLive: Story = {
  name: 'Phone-Home-Live — до півночі (телефон, 390)',
  globals: { surface: 'phone' },
};

export const DelayNotice: Story = {
  name: '−5 хв … 0 — «відео може запізнюватися»',
  globals: { surface: 'desktop' },
  args: at(-3 * MIN),
  parameters: { time: { at: iso(-3 * MIN), frozen: true } },
};

export const Moment: Story = {
  name: '+15 с — «Велика Британія зустріла Новий рік», без таймера',
  globals: { surface: 'phone' },
  args: at(20_000),
  parameters: { time: { at: iso(20_000), frozen: true } },
};

export const PhoneHomeHandover: Story = {
  name: 'Phone-Home-Handover — «далі через 0:59», «Далі: Азорські острови», «Лишитися тут ›»',
  globals: { surface: 'phone' },
  args: at(14 * MIN + 1_000),
  parameters: { time: { at: iso(14 * MIN + 1_000), frozen: true } },
};

export const DeskHomeHandover: Story = {
  name: 'Desk-Home-Handover — остання хвилина (десктоп)',
  globals: { surface: 'desktop' },
  args: at(14 * MIN + 1_000),
  parameters: { time: { at: iso(14 * MIN + 1_000), frozen: true } },
};

export const NextEventNoStream: Story = {
  name: '+15 хв — наступна подія без трансляції: сцена відліку на місці плеєра',
  globals: { surface: 'phone' },
  args: at(15 * MIN + 5_000),
  parameters: { time: { at: iso(15 * MIN + 5_000), frozen: true } },
};

export const Switched: Story = {
  name: 'Phone-Player-Switched — «Перемкнули на іншу трансляцію з цього місця»',
  globals: { surface: 'phone' },
  args: at(-10 * MIN, { switched: true }),
  parameters: { time: { at: iso(-10 * MIN), frozen: true } },
};

export const FacebookConsent: Story = {
  name: 'Phone-Player-Facebook — картка згоди на місці плеєра, звук неактивний',
  globals: { surface: 'phone' },
  args: at(-10 * MIN, { videoArea: 'facebook-consent' }),
  parameters: { time: { at: iso(-10 * MIN), frozen: true } },
};

export const ScheduleHint: Story = {
  name: 'FR-014 — «За вашим графіком зараз — Канарські острови · Перейти ›»',
  globals: { surface: 'desktop' },
  args: at(-2 * MIN, { scheduleHint: { place: 'Канарські острови', href: '/country/ispaniia/' } }),
  parameters: { time: { at: iso(-2 * MIN), frozen: true } },
};

export const Loading: Story = {
  name: 'l — час ще невідомий (скелетони)',
  globals: { surface: 'phone' },
  args: { mode: 'broadcast', ready: false, phase: null, current: null, next: null, videoArea: 'loading' },
};

/** Пульт (сторінка країни) після півночі: запис, «північ була … тому», кнопка повтору лише якщо джерело дає повтор. */
function remoteAt(offsetMs: number, hasReplay: boolean): PlayerBlockProps {
  const now = LONDON + offsetMs;
  const b = computeBroadcast(now);
  return {
    mode: 'remote',
    ready: true,
    phase: b.current ? captionPhase(now, b.current.event, 'remote', b.next?.event ?? null, { hasReplay }) : null,
    current: b.current,
    next: b.next,
    timeZone: 'Europe/Kyiv',
    videoArea: 'video',
    onWatchAgain: () => undefined,
  };
}

export const RemoteAfterMidnightReplay: Story = {
  name: 'Пульт після півночі (+40 хв) — «Запис», «північ була … тому», «Подивитися північ ще раз»',
  globals: { surface: 'desktop' },
  args: remoteAt(40 * MIN, true),
  parameters: { time: { at: iso(40 * MIN), frozen: true } },
};

export const RemoteAfterMidnightNoReplay: Story = {
  name: 'Пульт після півночі (+40 хв) — джерело без повтору: кнопки повтору немає',
  globals: { surface: 'phone' },
  args: remoteAt(40 * MIN, false),
  parameters: { time: { at: iso(40 * MIN), frozen: true } },
};
