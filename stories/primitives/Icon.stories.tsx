import type { Meta, StoryObj } from '@storybook/nextjs';
import { Icon, type IconName, type IconSize } from '@/components/primitives/Icon';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Icon', component: Icon, args: { name: 'speaker' } } satisfies Meta<typeof Icon>;
export default meta;
type Story = StoryObj<typeof meta>;

const NAMES: IconName[] = [
  'speaker', 'speaker-off', 'ticket', 'ticket-check', 'calendar', 'calendar-add', 'calendar-check', 'clock', 'broadcast',
  'broadcast-dashed', 'user', 'menu', 'more', 'close', 'plus', 'minus', 'check', 'chevron-right', 'chevron-left',
  'chevron-down', 'chevron-up', 'arrow-down', 'arrow-left', 'globe', 'pause', 'play', 'search', 'info', 'alert', 'wifi-off',
  'send', 'smile', 'tv', 'share', 'expand', 'star', 'dot',
];
const SIZES: IconSize[] = [16, 18, 20, 22];

export const All: Story = {
  render: () => (
    <Stage>
      <StateRow label="Усі іконки (stroke 1.8, 22 px)">
        {NAMES.map((n) => (
          <div key={n} className="flex w-24 flex-col items-center gap-1 text-text">
            <Icon name={n} size={22} />
            <span className="text-caption text-text-muted">{n}</span>
          </div>
        ))}
      </StateRow>
    </Stage>
  ),
};

export const Sizes: Story = {
  render: () => (
    <Stage>
      <StateRow label="16 · 18 · 20 · 22">
        {SIZES.map((s) => (
          <Icon key={s} name="speaker" size={s} className="text-text" />
        ))}
      </StateRow>
    </Stage>
  ),
};
