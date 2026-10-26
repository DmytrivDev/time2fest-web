import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Rate, type RateRow } from '@/components/windows/Rate';
import { renderApp, wrap } from './render';

const LONDON: RateRow = { eventId: 'e1', countryName: 'Велика Британія', city: 'Лондон', flagCode: 'GB' };
const DUBLIN: RateRow = { eventId: 'e2', countryName: 'Ірландія', city: 'Дублін', flagCode: 'IE' };

describe('Rate', () => {
  it('«Як тобі шоу?», рядок події, 5 зірок, підписи й примітка; коралової кнопки немає', () => {
    renderApp(<Rate rows={[LONDON]} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Як тобі шоу?' })).toBeInTheDocument();
    expect(screen.getByText('Велика Британія · Лондон')).toBeInTheDocument();
    expect(screen.getAllByRole('radio')).toHaveLength(5);
    expect(screen.getByRole('radio', { name: '3 з 5' })).toBeInTheDocument();
    expect(screen.getByText('слабко')).toBeInTheDocument();
    expect(screen.getByText('неймовірно')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'рейтингу міст' })).toBeInTheDocument();
    expect(document.querySelector('[data-variant="coral"]')).toBeNull();
  });

  it('кілька подій — кілька груп зірок', () => {
    renderApp(<Rate rows={[LONDON, DUBLIN]} />);
    expect(screen.getAllByRole('radiogroup')).toHaveLength(2);
    expect(screen.getAllByRole('radio')).toHaveLength(10);
  });

  it('вибір зірки викликає onRate; після оцінки всіх подій — «Дякуємо»', () => {
    const onRate = vi.fn();
    renderApp(<Rate rows={[LONDON]} onRate={onRate} />);
    expect(screen.queryByText('Дякуємо')).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '4 з 5' }));
    expect(onRate).toHaveBeenCalledWith('e1', 4);
    expect(screen.getByText('Дякуємо')).toBeInTheDocument();
  });

  it('помилка: повідомлення й «Спробувати ще»', () => {
    const onRetry = vi.fn();
    renderApp(<Rate rows={[LONDON]} status="error" onRetry={onRetry} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Не вдалося надіслати оцінку');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('закрито: нічого не малюється', () => {
    const { container } = renderApp(<Rate rows={[LONDON]} status="closed" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('«×» повідомляє про закриття гостем', () => {
    const onClose = vi.fn();
    renderApp(<Rate rows={[LONDON]} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Закрити оцінку' }));
    expect(onClose).toHaveBeenCalledWith('dismissed');
  });

  it('фокус усередині = взаємодія (WCAG 2.2.1)', () => {
    const onInteraction = vi.fn();
    renderApp(<Rate rows={[LONDON]} onInteractionChange={onInteraction} />);
    expect(onInteraction).toHaveBeenLastCalledWith(false);
    act(() => screen.getAllByRole('radio')[0]!.focus());
    expect(onInteraction).toHaveBeenLastCalledWith(true);
    act(() => (document.activeElement as HTMLElement).blur());
    expect(onInteraction).toHaveBeenLastCalledWith(false);
  });

  it('за часом закривається, коли немає взаємодії', () => {
    const onClose = vi.fn();
    const now = Date.parse('2027-01-01T00:05:01Z');
    renderApp(<Rate rows={[LONDON]} closesAt={now - 1000} onClose={onClose} />, now);
    expect(onClose).toHaveBeenCalledWith('timeout', undefined);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('до часу закриття — не закривається', () => {
    const onClose = vi.fn();
    const now = Date.parse('2027-01-01T00:04:00Z');
    renderApp(<Rate rows={[LONDON]} closesAt={now + 60_000} onClose={onClose} />, now);
    expect(onClose).not.toHaveBeenCalled();
  });

  it('поки фокус усередині — закриття за часом відкладається до його втрати', () => {
    const onClose = vi.fn();
    const now = Date.parse('2027-01-01T00:05:01Z');
    const { rerender } = render(wrap(<Rate rows={[LONDON]} onClose={onClose} />, now));
    act(() => screen.getAllByRole('radio')[0]!.focus());
    rerender(wrap(<Rate rows={[LONDON]} closesAt={now - 1000} onClose={onClose} />, now));
    expect(onClose).not.toHaveBeenCalled();
    act(() => (document.activeElement as HTMLElement).blur());
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
