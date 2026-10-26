import type { Meta, StoryObj } from '@storybook/nextjs';
import { useEffect } from 'react';
import { FacebookConsentCard } from '@/components/player/FacebookConsentCard';
import { PlayerSlot } from '@/components/player/PlayerSlot';
import { CoralProvider } from '@/lib/overlay/coral';
import { useGuestStore } from '@/stores/guest';
import { Stage } from '../_support/Stage';
import { PendingIntl } from '../us1/PendingIntl';

const meta = {
  title: 'Плеєр/FacebookConsentCard',
  component: FacebookConsentCard,
  globals: { surface: 'phone' },
  decorators: [(Story) => <PendingIntl>{Story()}</PendingIntl>],
} satisfies Meta<typeof FacebookConsentCard>;
export default meta;
type Story = StoryObj<typeof meta>;

function Reset({ allowed }: { allowed: boolean }) {
  useEffect(() => {
    useGuestStore.getState().setConsent({ facebookVideo: allowed });
    return () => useGuestStore.getState().setConsent({ facebookVideo: false });
  }, [allowed]);
  return null;
}

export const Needed: Story = {
  name: 'Phone-Player-Facebook — потрібна згода (одна коралова кнопка)',
  render: () => (
    <CoralProvider>
      <Reset allowed={false} />
      <Stage>
        <PlayerSlot fallback={<FacebookConsentCard />} />
      </Stage>
    </CoralProvider>
  ),
};

export const Allowed: Story = {
  name: 'згоду дано — плеєр вантажиться',
  render: () => (
    <CoralProvider>
      <Reset allowed />
      <Stage>
        <PlayerSlot fallback={<FacebookConsentCard />} />
      </Stage>
    </CoralProvider>
  ),
};

export const Desktop: Story = {
  name: 'десктоп',
  globals: { surface: 'desktop' },
  render: () => (
    <CoralProvider>
      <Reset allowed={false} />
      <Stage>
        <div className="mx-auto w-full max-w-3xl">
          <PlayerSlot fallback={<FacebookConsentCard />} />
        </div>
      </Stage>
    </CoralProvider>
  ),
};
