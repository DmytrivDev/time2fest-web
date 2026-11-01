import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { clearStampMoment, showStampMoment, StampBlock } from '@/components/live/StampBlock';
import { OverlayManager, useOverlay } from '@/components/shell/OverlayManager';
import { emit } from '@/lib/events/bus';
import { useGuestStore } from '@/stores/guest';
import { renderApp } from './render';

function OpenSideWindow() {
  const { open } = useOverlay();
  return (
    <button type="button" onClick={() => open({ id: 'O-STREAM-PICKER', kind: 'accent', chrome: 'board', title: 'Обрати трансляцію', content: <p>picker</p> })}>
      side
    </button>
  );
}

const stampBlock = () => document.querySelector('[data-stamp-block] [data-stamp]');

beforeEach(() => {
  useGuestStore.getState().resetGuest();
  clearStampMoment();
});
afterEach(() => clearStampMoment());

describe('StampBlock — окремий блок під плеєром (рішення 2026-11-01)', () => {
  it('+15 с показує штамп; вікно збоку його не прибирає', () => {
    renderApp(
      <OverlayManager>
        <OpenSideWindow />
        <StampBlock eventId="evt_london_2027" />
      </OverlayManager>,
    );
    expect(stampBlock()).toBeNull();
    act(() => showStampMoment(['evt_london_2027'], false));
    expect(screen.getByRole('heading', { level: 2, name: 'Лондон' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'side' }));
    expect(stampBlock()).not.toBeNull();
  });

  it('«×» прибирає саме цей штамп і він не повертається; у паспорті лишається', () => {
    useGuestStore.getState().addStamp({
      eventId: 'evt_london_2027',
      grantedAt: 0,
      presenceSource: 'air',
      illustrationId: 'gb-postcard',
      cityName: 'Лондон',
      countryIso: 'GB',
    });
    renderApp(
      <OverlayManager>
        <StampBlock eventId="evt_london_2027" />
      </OverlayManager>,
    );
    // Після перезавантаження: штамп поточної події вже є → блок видно без «удару».
    expect(stampBlock()).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати штамп' }));
    expect(useGuestStore.getState().stampsDismissed).toEqual(['evt_london_2027']);
    expect(useGuestStore.getState().stamps).toHaveLength(1);
    expect(document.querySelector('.t2f-reveal')).toHaveAttribute('data-open', 'false');
  });

  it('зміна ефіру прибирає штамп попередньої події', () => {
    renderApp(
      <OverlayManager>
        <StampBlock eventId={null} />
      </OverlayManager>,
    );
    act(() => showStampMoment(['evt_london_2027'], false));
    expect(document.querySelector('.t2f-reveal')).toHaveAttribute('data-open', 'true');
    act(() => {
      emit('air:handover', {
        eventKey: 'k',
        at: 0,
        fromEventId: 'evt_london_2027',
        toEventId: 'x',
        viewChanged: 'stream',
        stayedHere: false,
        reason: 'timer',
      });
    });
    expect(document.querySelector('.t2f-reveal')).toHaveAttribute('data-open', 'false');
  });
});
