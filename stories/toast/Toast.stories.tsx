/**
 * Тост — головний платний продукт (дошки `Desk-Toast-New`, `Phone-Toast-New` v2, рішення власника 2026-11-12):
 * бульбашки за рівнем, смуга тостів (порожня / з тостами), вікно «Сказати тост» у головних станах.
 * У Storybook збірка не тестова — імітованих тостів немає (як у робочій): тости для смуги — «свої» зі стору.
 */
import type { Decorator, Meta, StoryObj } from '@storybook/nextjs';
import type { ReactNode } from 'react';
import { ToastBubble } from '@/components/toast/ToastBubble';
import { ToastStrip } from '@/components/toast/ToastStrip';
import { ToastWindowContent } from '@/components/toast/ToastWindow';
import { getData } from '@/lib/data/load';
import type { ToastRecord } from '@/lib/toast/feed';
import { CoralProvider } from '@/lib/overlay/coral';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useToastStore, type ToastFlowState } from '@/stores/toast';
import { Stage } from '../_support/Stage';

const PARIS = getData().zones.find((z) => z.offsetMinutes === 60)!.midnightMs;
const AT = new Date(PARIS - 20 * 60_000).toISOString();
const MIN = 60_000;
const T = (id: string, nick: string, flagCode: string, text: string, tier: 2 | 5 | 10, ago: number): ToastRecord => ({
  id,
  nick,
  flagCode,
  text,
  tier,
  createdAt: PARIS - 20 * MIN - ago * MIN,
  pass: tier === 10,
});
const SAID: ToastRecord[] = [
  T('a', 'Олена', 'UA', 'За тих, хто зараз далеко від дому, — ми з вами ❤️', 10, 12),
  T('b', 'Marie', 'FR', 'Bonne année à tous ! Хай кожен знайде своїх 🥂', 5, 9),
  T('c', 'Hiro', 'JP', 'Happy New Year! Дякую, що можна дивитися все разом 🎆', 2, 0),
  T('d', 'Carlos', 'BR', 'Feliz Ano Novo! Saúde a todos 🎉', 2, 3),
];

/** Стан тосту й гостя для історії. */
function withState(flow: Partial<ToastFlowState>, guest: { nick?: string; hasPass?: boolean } = { nick: 'Олена' }, signedIn = false): Decorator {
  return function ToastState(Story) {
    useGuestStore.setState({ nick: guest.nick, flagCode: 'UA', detectedFlag: 'UA' });
    // Пас — лише з акаунта (шов, залишки E5): власник пасу в історії — той, хто увійшов, з пасом на акаунті.
    useAuthStore.setState({
      user: signedIn || guest.hasPass ? { email: 'olena@example.com', via: 'email', signedInAt: 0 } : null,
      passes: guest.hasPass ? { 'olena@example.com': 0 } : {},
    });
    useToastStore.setState({ phase: 'form', tier: 5, text: '🥂 За всіх, хто зустрічає разом!', issue: null, gift: null, said: SAID, ...flow });
    return <Story />;
  };
}

function Win({ children }: { children: ReactNode }) {
  return (
    <CoralProvider>
      <Stage>
        <div className="flex flex-col overflow-hidden rounded-lg border border-border bg-surface" style={{ width: '21.25rem', height: '50rem' }}>
          {children}
        </div>
      </Stage>
    </CoralProvider>
  );
}

const meta = {
  title: 'Тост/Тост',
  parameters: { time: { at: AT, frozen: true } },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Bubbles: Story = {
  name: 'бульбашки: «щойно» · $2 · $5 · $10',
  render: () => (
    <Stage>
      <div className="flex flex-col gap-2" style={{ width: '21.25rem' }}>
        <ToastBubble nick="Hiro" flagCode="JP" text="Happy New Year! 🎆" tier="plain" aside="щойно" />
        <ToastBubble nick="Carlos" flagCode="BR" text="Feliz Ano Novo! 🎉" tier={2} aside="00:40" meta />
        <ToastBubble nick="Marie" flagCode="FR" text="Bonne année à tous ! 🥂" tier={5} aside="00:41" meta />
        <ToastBubble nick="Олена" flagCode="UA" text="За тих, хто зараз далеко від дому ❤️" tier={10} aside="00:42" meta pass />
      </div>
    </Stage>
  ),
};

export const StripEmptyPhone: Story = {
  name: 'смуга · телефон · порожньо',
  globals: { surface: 'phone' },
  decorators: [withState({ said: [] })],
  render: () => <ToastStrip variant="phone" />,
};

export const StripPhone: Story = {
  name: 'смуга · телефон · тости',
  globals: { surface: 'phone' },
  decorators: [withState({})],
  render: () => <ToastStrip variant="phone" />,
};

export const StripEmptyDesk: Story = {
  name: 'смуга · десктоп · порожньо',
  globals: { surface: 'desktop' },
  decorators: [withState({ said: [] })],
  render: () => (
    <Stage>
      <ToastStrip variant="desk" />
    </Stage>
  ),
};

export const StripDesk: Story = {
  name: 'смуга · десктоп · один тост повністю',
  globals: { surface: 'desktop' },
  decorators: [withState({})],
  render: () => (
    <Stage>
      <ToastStrip variant="desk" />
    </Stage>
  ),
};

const win = () => (
  <Win>
    <ToastWindowContent onClose={() => undefined} />
  </Win>
);

export const Step1: Story = { name: 'вікно · крок 1 ($5)', decorators: [withState({})], render: win };
export const Step1Pass: Story = { name: 'вікно · з пасом ($10)', decorators: [withState({ tier: 10 }, { nick: 'Олена', hasPass: true })], render: win };
export const Guest: Story = { name: 'вікно · гість без ніку', decorators: [withState({}, {})], render: win };
export const Filter: Story = {
  name: 'вікно · фільтр не пропустив',
  decorators: [withState({ text: 'Пишіть мені: t.me/olena_ny 🎉', issue: { kind: 'link', start: 13, end: 26 } })],
  render: win,
};
export const Paying: Story = { name: 'вікно · чекаємо оплату', decorators: [withState({ phase: 'paying' })], render: win };
export const Failed: Story = { name: 'вікно · оплата не пройшла', decorators: [withState({ phase: 'failed' })], render: win };
export const Success5: Story = {
  name: 'вікно · успіх $5',
  decorators: [withState({ phase: 'success', last: { ...SAID[1]!, nick: 'Олена', flagCode: 'UA', mine: true } })],
  render: win,
};
export const Success10Guest: Story = {
  name: 'вікно · успіх $10 · гість (пас чекає входу)',
  decorators: [withState({ phase: 'success', gift: 'pending', last: { ...SAID[0]!, mine: true } })],
  render: win,
};
export const Success10Signed: Story = {
  name: 'вікно · успіх $10 · пас активний',
  decorators: [withState({ phase: 'success', gift: 'active', last: { ...SAID[0]!, mine: true } }, { nick: 'Олена', hasPass: true }, true)],
  render: win,
};
