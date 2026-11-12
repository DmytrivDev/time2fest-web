import type { Meta, StoryObj } from '@storybook/nextjs';
import { userEvent } from 'storybook/test';
import { Badge } from '@/components/primitives/Badge';
import { Flag } from '@/components/primitives/Flag';
import { Stage, StateRow } from '../_support/Stage';

const meta = { title: 'Примітиви/Badge', component: Badge, args: { variant: 'live' } } satisfies Meta<typeof Badge>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Live: Story = {
  render: () => (
    <Stage>
      <StateRow label="live: #C8323A, 12/600, висота 22 · live-quiet (рядки списків) · ТВ 22/40">
        <Badge variant="live" />
        <Badge variant="live-quiet" />
        <Badge variant="live" size="tv" />
      </StateRow>
    </Stage>
  ),
};

export const Status: Story = {
  render: () => (
    <Stage>
      <StateRow label="on-air · soon · recording · replay · verified">
        <Badge variant="on-air" />
        <Badge variant="soon" />
        <Badge variant="soon">за 5 хв</Badge>
        <Badge variant="recording" />
        <Badge variant="replay" />
        <Badge variant="verified" />
      </StateRow>
      <StateRow label="stream-status (4): наживо · очікується · можлива · лише відлік">
        <Badge variant="stream-status" status="live" />
        <Badge variant="stream-status" status="expected" />
        <Badge variant="stream-status" status="possible" />
        <Badge variant="stream-status" status="countdown-only" />
      </StateRow>
      <StateRow label="in-schedule (жовта капсула-календар) · your-midnight · you">
        <Badge variant="in-schedule" />
        <Badge variant="your-midnight" />
        <Badge variant="you" />
        <Badge variant="you">це ти</Badge>
      </StateRow>
    </Stage>
  ),
};

export const People: Story = {
  name: 'Позначки людей (чат)',
  render: () => (
    <Stage>
      <StateRow label="vip — квиток у жовтому колі 16 px + підказка">
        <span className="inline-flex items-center gap-2 text-body-strong text-text">
          <Flag code="EG" size="xs" decorative />
          Аміра
          <Badge variant="vip" />
        </span>
      </StateRow>
    </Stage>
  ),
};

export const Counts: Story = {
  render: () => (
    <Stage>
      <StateRow label="count: 3 · 42 · 99+">
        <Badge variant="count" value={3} />
        <Badge variant="count" value={42} />
        <Badge variant="count" value={120} />
      </StateRow>
    </Stage>
  ),
};

export const VipTooltipFocus: Story = {
  name: 'VIP · підказка на фокусі',
  render: () => (
    <Stage>
      <Badge variant="vip" />
    </Stage>
  ),
  play: async () => {
    await userEvent.tab();
  },
};
