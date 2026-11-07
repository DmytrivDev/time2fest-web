import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearStampMoment, showStampMoment, StampBlock } from '@/components/live/StampBlock';
import { OverlayManager, useOverlay } from '@/components/shell/OverlayManager';
import { emit } from '@/lib/events/bus';
import { useGuestStore } from '@/stores/guest';
import { renderApp } from './render';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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

  it('«Як тобі шоу?» — разом зі штампом; зірки → «Ти поставив 4 з 5 · Підтвердити · Змінити» → «Твоя оцінка», без зсуву зірок', () => {
    renderApp(
      <OverlayManager>
        <StampBlock eventId={null} />
      </OverlayManager>,
      '2027-01-01T00:00:16Z',
    );
    act(() => showStampMoment(['evt_london_2027'], false));
    const row = () => document.querySelector('[data-stamp-rate] [data-state]');
    expect(row()).not.toHaveAttribute('data-rated');
    expect(screen.queryByText(/слабко|неймовірно/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '4 з 5' }));
    // Спершу — підтвердження (рішення власника 2026-11-07): оцінка ще не збережена.
    expect(useGuestStore.getState().rate['evt_london_2027']).toBeUndefined();
    expect(row()).toHaveAttribute('data-state', 'chosen');
    fireEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    expect(row()).toHaveAttribute('data-state', 'ask');
    fireEvent.click(screen.getByRole('radio', { name: '4 з 5' }));
    fireEvent.click(screen.getByRole('button', { name: 'Підтвердити' }));
    expect(useGuestStore.getState().rate['evt_london_2027']?.stars).toBe(4);
    expect(row()).toHaveAttribute('data-rated', 'true');
    expect(screen.getByRole('link', { name: /Рейтинг святкувань/ })).toHaveAttribute('href', expect.stringMatching(/^\/rating\/?$/));
    // Обидва підписи лишаються в розмітці (тримають ширину); видимий — «Твоя оцінка».
    expect(screen.getByText('Твоя оцінка').closest('[aria-hidden]')).toBeNull();
    expect(screen.getByText('Як тобі шоу?').closest('[aria-hidden]')).not.toBeNull();
  });

  it('«Мій паспорт» веде на /passport/', () => {
    renderApp(
      <OverlayManager>
        <StampBlock eventId={null} />
      </OverlayManager>,
    );
    act(() => showStampMoment(['evt_london_2027'], false));
    fireEvent.click(screen.getByRole('button', { name: 'Мій паспорт' }));
    expect(push).toHaveBeenCalledWith('/passport/');
  });
});
