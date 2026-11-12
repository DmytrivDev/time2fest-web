import { act, fireEvent, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Stamp, type StampEntry } from '@/components/windows/Stamp';
import { CoralProvider, useCoralWindowOpen } from '@/lib/overlay/coral';
import { renderApp } from './render';

const SYDNEY: StampEntry = { city: 'Сідней', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const MELBOURNE: StampEntry = { city: 'Мельбурн', countryName: 'Австралія', flagCode: 'AU', illustrationId: 'au-postcard' };
const LONDON: StampEntry = { city: 'Лондон', countryName: 'Велика Британія', flagCode: 'GB', illustrationId: 'gb-postcard' };

function Sound() {
  return <span data-testid="sound">{useCoralWindowOpen() ? 'neutral' : 'coral'}</span>;
}

afterEach(() => vi.useRealTimers());

describe('Stamp', () => {
  it('заголовок — місто, нижче країна й рік (без відмінків); alt листівки = текст штампа; коралова «Поділитися»', () => {
    renderApp(<Stamp stamps={[SYDNEY]} />);
    expect(screen.getByRole('heading', { level: 2, name: /Сідней/ })).toBeInTheDocument();
    expect(screen.getByText('Австралія · Новий рік 2027')).toBeInTheDocument();
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
    expect(screen.getByRole('heading', { level: 2, name: /Сідней · Мельбурн/ })).toBeInTheDocument();
    expect(screen.getByText('Австралія · Новий рік 2027')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'НОВИЙ РІК 2027 · СІДНЕЙ · МЕЛЬБУРН' })).toBeInTheDocument();
  });

  it('без рамки й рядка «Перший ряд» (ряд прибрано 2026-11-12)', () => {
    const { container } = renderApp(<Stamp stamps={[LONDON]} />);
    expect(container.querySelector('[data-first-row]')).toBeNull();
    expect(container.querySelector('[data-frame="inner"]')).toBeNull();
    expect(screen.queryByText(/Перший ряд/)).toBeNull();
  });

  it('save-failed: повідомлення й тиха «Спробувати ще»', () => {
    const onRetry = vi.fn();
    renderApp(<Stamp stamps={[SYDNEY]} saveState="failed" onRetrySave={onRetry} />);
    expect(screen.getByText('Збережемо самі, щойно з’явиться зв’язок')).toBeInTheDocument();
    expect(screen.queryByText('Уже в твоєму паспорті')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('завжди розгорнутий: коралова «Поділитися» робить кнопку звуку нейтральною; «×» — «Прибрати штамп»', () => {
    const onClose = vi.fn();
    renderApp(
      <CoralProvider>
        <Sound />
        <Stamp stamps={[SYDNEY]} onClose={onClose} />
      </CoralProvider>,
    );
    expect(screen.getByTestId('sound')).toHaveTextContent('neutral');
    fireEvent.click(screen.getByRole('button', { name: 'Прибрати штамп' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('смужка — градієнт кольорів прапора; майже білий стає справжнім білим', () => {
    const { container } = renderApp(<Stamp stamps={[{ ...SYDNEY, flagCode: 'JP', countryName: 'Японія' }]} />);
    const strip = container.querySelector<HTMLElement>('[aria-hidden="true"][style*="--flag"]');
    expect(strip?.style.getPropertyValue('--flag')).toBe('linear-gradient(180deg, #ffffff 25%, #d80027 75%)');
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
