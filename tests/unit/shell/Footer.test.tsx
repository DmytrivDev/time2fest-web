/**
 * Футер за дошкою `Desk-Footer-New`, варіант B (рішення власника 2026-11-08): бренд, пошта й соцмережі, три колонки
 * «Свято» / «Твоє» / «Довідка» (на телефоні — акордеони), унизу Умови · Конфіденційність · Cookies, спалахи, «Зменшити рух».
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Footer } from '@/components/shell/Footer';
import messages from '@/messages/uk.json';
import { useAuthStore } from '@/stores/auth';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  useAuthStore.setState({ user: null });
});

describe('Футер (варіант B)', () => {
  it('бренд, пошта підтримки, соцмережі; без вибору мови', () => {
    wrap(<Footer />);
    const footer = screen.getByRole('contentinfo');
    expect(within(footer).getByRole('link', { name: 'Time2Fest — на головну' }).getAttribute('href')).toBe('/');
    expect(within(footer).getByRole('link', { name: /support@time2fest\.com/ }).getAttribute('href')).toBe('mailto:support@time2fest.com');
    const social = within(footer).getByRole('list', { name: 'Ми в соцмережах' });
    expect(within(social).getAllByRole('link').map((a) => a.getAttribute('aria-label'))).toEqual(['Telegram', 'Instagram']);
    expect(within(footer).queryByText('Українська')).toBeNull();
    expect(within(footer).getByText(/© 2026 Time2Fest · Зроблено в Україні/)).toBeTruthy();
  });

  it('три колонки ведуть на розділи; унизу — документи', () => {
    wrap(<Footer />);
    const nav = screen.getByRole('navigation', { name: 'Довідкові посилання' });
    const href = (name: string) => within(nav).getByRole('link', { name }).getAttribute('href')?.replace(/\/$/, ''); // NextLink у тестах без кінцевої «/»
    expect(href('Країни й міста')).toBe('/countries');
    expect(href('Мій графік')).toBe('/schedule');
    expect(href('Рейтинг святкувань')).toBe('/rating');
    expect(href('Режим вечірки')).toBe('/tv');
    expect(href('Паспорт')).toBe('/passport');
    expect(href('Новорічний пас')).toBe('/pass');
    expect(href('Тости')).toBe('/support');
    expect(href('Увійти')).toBe('/login');
    expect(href('Правила чату')).toBe('/rules');
    expect(href('Оплата й повернення')).toBe('/payments');
    const docs = screen.getByRole('list', { name: 'Документи' });
    expect(within(docs).getAllByRole('link').map((a) => [a.textContent, a.getAttribute('href')?.replace(/\/$/, '')])).toEqual([
      ['Умови', '/terms'],
      ['Конфіденційність', '/privacy'],
      ['Cookies', '/cookies'],
    ]);
  });

  it('телефон: колонка — акордеон, кнопка перемикає розгортання', () => {
    wrap(<Footer />);
    const btn = screen.getByRole('button', { name: 'Довідка' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    const panel = document.getElementById(btn.getAttribute('aria-controls')!)!;
    expect(panel).toHaveAttribute('data-open', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
    expect(panel).toHaveAttribute('data-open', 'true');
  });

  it('«Налаштування cookies» — кнопка з обробником; «Увійти» зникає після входу', () => {
    const onCookies = vi.fn();
    useAuthStore.setState({ user: { email: 'a@b.c', via: 'email', signedInAt: 0 } } as never);
    wrap(<Footer onCookiesClick={onCookies} />);
    fireEvent.click(screen.getByRole('button', { name: 'Налаштування cookies' }));
    expect(onCookies).toHaveBeenCalledOnce();
    expect(screen.queryByRole('link', { name: 'Увійти' })).toBeNull();
  });

  it('спалахи й «Зменшити рух» лишаються', () => {
    const onChange = vi.fn();
    wrap(<Footer reducedMotion={false} onReducedMotionChange={onChange} />);
    expect(screen.getByText('Трансляції феєрверків можуть містити спалахи')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Зменшити рух' }));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
