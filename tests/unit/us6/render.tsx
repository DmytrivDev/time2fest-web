import { render } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import type { ReactElement } from 'react';
import { OverlayInFlowOutlet, OverlayManager } from '@/components/shell/OverlayManager';
import { CoralProvider, useCoralWindowOpen } from '@/lib/overlay/coral';
import { TimeProvider } from '@/lib/time/TimeProvider';
import messages from '@/messages/uk.json';

export { messages };

/** Довільний «зараз» — рушій пропозицій у цих тестах не запускається, час потрібен лише годиннику. */
export const NOW = '2027-01-01T00:06:00Z';

export function Sound() {
  return <span data-testid="sound">{useCoralWindowOpen() ? 'neutral' : 'coral'}</span>;
}

export function renderPage(ui: ReactElement, now: string | number = NOW) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <TimeProvider override={{ at: now, frozen: true }}>
        <CoralProvider>
          <OverlayManager>
            <Sound />
            {ui}
            <OverlayInFlowOutlet />
          </OverlayManager>
        </CoralProvider>
      </TimeProvider>
    </NextIntlClientProvider>,
  );
}

export function renderPlain(ui: ReactElement) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages as never}>
      <CoralProvider>{ui}</CoralProvider>
    </NextIntlClientProvider>,
  );
}
