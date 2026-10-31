import { fireEvent, screen } from '@testing-library/react';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { MoreActionsList, ReportProblem } from '@/components/live/MoreActions';
import { liveRowsForMidnight } from '@/components/live/StreamPicker';
import { getData } from '@/lib/data/load';
import { renderWithApp } from '../_support/render';

beforeAll(() => {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: () => {}, removeEventListener: () => {} })));
});

const TARGET = { url: 'https://time2fest.com/country/velyka-brytaniia/', shortUrl: 'time2fest.com/country/velyka-brytaniia/', text: 'Лондон — наживо на Time2Fest' };

describe('«Обрати трансляцію» (рішення 2026-11-01)', () => {
  it('лише трансляції цієї півночі, що йдуть зараз; поточна — першою', () => {
    const london = getData().events.find((e) => e.id === 'evt_london_2027')!;
    const now = london.midnightMs + 60_000;
    const rows = liveRowsForMidnight(london.midnightMs, now);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.status === 'live' && r.midnightMs === london.midnightMs)).toBe(true);
    const last = rows.at(-1)!.id;
    expect(liveRowsForMidnight(london.midnightMs, now, last)[0]!.id).toBe(last);
  });
});

describe('«Ще дії»', () => {
  it('телефон: кімната, режим вечірки, поділитися, повідомити (наступний екран)', () => {
    const onReport = vi.fn();
    renderWithApp(<MoreActionsList target={TARGET} onReport={onReport} />);
    expect(screen.getByRole('link', { name: /Кімната перегляду/ }).getAttribute('href')).toMatch(/^\/room\/?$/);
    expect(screen.getByRole('link', { name: /Режим вечірки/ }).getAttribute('href')).toMatch(/^\/tv\/?$/);
    expect(screen.getByRole('button', { name: /Поділитися трансляцією/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Повідомити про проблему/ }));
    expect(onReport).toHaveBeenCalled();
  });

  it('повідомити про проблему: «Надіслати» лише після вибору, далі — «Дякуємо» з «Обрати трансляцію»', () => {
    const onChooseStream = vi.fn();
    renderWithApp(<ReportProblem center onChooseStream={onChooseStream} onClose={() => undefined} />);
    const send = screen.getByRole('button', { name: 'Надіслати' });
    expect(send).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: 'Трансляція зупинилась' }));
    fireEvent.click(send);
    expect(screen.getByRole('status')).toHaveTextContent('Дякуємо! Ми перевіримо трансляцію');
    fireEvent.click(screen.getByRole('button', { name: /Обрати трансляцію/ }));
    expect(onChooseStream).toHaveBeenCalled();
  });
});
