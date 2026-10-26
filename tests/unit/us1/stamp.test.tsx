import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { CoralProvider, useCoralWindowOpen } from '@/lib/overlay/coral';
import { renderApp } from './render';

const SYDNEY: StampEntry = { city: 'Сідней', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const MELBOURNE: StampEntry = { city: 'Мельбурн', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const LONDON: StampEntry = { city: 'Лондон', countryName: 'Велика Британія', flagCode: 'GB', illustrationId: 'gb-postcard', firstRowSeat: 4 };

function Sound() {
  return <span data-testid="sound">{useCoralWindowOpen() ? 'neutral' : 'coral'}</span>;
}

afterEach(() => vi.useRealTimers());

describe('Stamp', () => {
  it('розгорнутий: заголовок, alt листівки = текст штампа, рядок для гостя, коралова «Поділитися»', () => {
    renderApp(<Stamp stamps={[SYDNEY]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Твій Новий рік 2027 — Сідней, Австралія' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'НОВИЙ РІК 2027 · СІДНЕЙ' })).toBeInTheDocument();
    expect(screen.getByText('Уже в твоєму паспорті')).toBeInTheDocument();
    expect(screen.getByText(/Збережено на цьому пристрої/)).toBeInTheDocument();
    const share = screen.getByRole('button', { name: 'Поділитися' });
    expect(share).toHaveAttribute('data-variant', 'coral');
    expect(document.querySelectorAll('[data-variant="coral"]')).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'Мій паспорт' })).toHaveAttribute('data-variant', 'secondary');
  });

  it('гість з акаунтом: без «Збережено на цьому пристрої»', () => {
    renderApp(<Stamp stamps={[SYDNEY]} signedIn />);
    expect(screen.queryByText(/Збережено на цьому пристрої/)).toBeNull();
  });

  it('«Поділитися» й «Мій паспорт» викликають передані обробники (інертні за замовчуванням)', () => {
    const onShare = vi.fn();
    const onPassport = vi.fn();
    renderApp(<Stamp stamps={[SYDNEY]} onShare={onShare} onPassport={onPassport} />);
    fireEvent.click(screen.getByRole('button', { name: 'Поділитися' }));
    fireEvent.click(screen.getByRole('button', { name: 'Мій паспорт' }));
    expect(onShare).toHaveBeenCalledTimes(1);
    expect(onPassport).toHaveBeenCalledTimes(1);
  });

  it('multi: «Сідней · Мельбурн»', () => {
    renderApp(<Stamp stamps={[SYDNEY, MELBOURNE]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Твій Новий рік 2027 — Сідней · Мельбурн' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'НОВИЙ РІК 2027 · СІДНЕЙ · МЕЛЬБУРН' })).toBeInTheDocument();
  });

  it('first-row: подвійна рамка й рядок «Перший ряд · Лондон»', () => {
    const { container } = renderApp(<Stamp stamps={[LONDON]} />);
    expect(container.querySelector('[data-first-row="true"]')).not.toBeNull();
    expect(container.querySelector('[data-frame="inner"]')).not.toBeNull();
    expect(screen.getByText('Перший ряд · Лондон')).toBeInTheDocument();
  });

  it('save-failed: повідомлення й тиха «Спробувати ще»', () => {
    const onRetry = vi.fn();
    renderApp(<Stamp stamps={[SYDNEY]} saveState="failed" onRetrySave={onRetry} />);
    expect(screen.getByText('Збережемо самі, щойно з’явиться зв’язок')).toBeInTheDocument();
    expect(screen.queryByText('Уже в твоєму паспорті')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('«×» згортає в рядок; коралової кнопки у згорнутому стані немає; рядок розгортає', () => {
    renderApp(
      <CoralProvider>
        <Sound />
        <Stamp stamps={[SYDNEY]} />
      </CoralProvider>,
    );
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(document.querySelectorAll('[data-variant="coral"]')).toHaveLength(0);
    expect(screen.getByTestId('sound')).toHaveTextContent('coral');
    expect(screen.getByRole('button', { name: 'Поділитися' })).toHaveAttribute('data-variant', 'secondary');
    fireEvent.click(screen.getByRole('button', { name: /Штамп у паспорті/ }));
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
  });

  it('«×» з onClose закриває замість згортання', () => {
    const onClose = vi.fn();
    renderApp(<Stamp stamps={[SYDNEY]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 2 })).toBeInTheDocument();
  });

  it('stamping: data-stamping=true лише на час «удару» (CSS грає його тільки у lively)', () => {
    vi.useFakeTimers();
    const { container } = renderApp(<Stamp stamps={[SYDNEY]} stamping />);
    expect(container.querySelector('[data-stamping="true"]')).not.toBeNull();
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(container.querySelector('[data-stamping="true"]')).toBeNull();
  });
});
