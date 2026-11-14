/**
 * Меню за дошкою `Desk-Menu-New` v2 (рішення власника 2026-11-08): мова угорі одним рядом (EN · ES · FR · УКР), картка людини,
 * розділи «Сайт» · «Моє свято» · «Дивитися» · «Ще», «Вийти» закріплене для того, хто увійшов.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Menu, MenuBody } from '@/components/shell/Menu';
import messages from '@/messages/uk.json';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { grantTestPass } from '@/tests/unit/_support/pass';

function wrap(ui: React.ReactNode) {
  return render(
    <NextIntlClientProvider locale="uk" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

afterEach(() => {
  useAuthStore.setState({ user: null });
  useGuestStore.setState({ nick: undefined });
});

describe('Меню v2', () => {
  it('мова — угорі одним рядом у порядку English, Español, Français, Українська', () => {
    const onLang = vi.fn();
    wrap(<Menu open onOpenChange={() => undefined} language="uk" onLanguageChange={onLang} />);
    const group = screen.getByRole('radiogroup', { name: 'Мова' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['English', 'Español', 'Français', 'Українська']);
    fireEvent.click(within(group).getByRole('radio', { name: 'English' }));
    expect(onLang).toHaveBeenCalledWith('en');
  });

  it('гість: картка «Увійти», розділи, без «Вийти»; «Мій графік» з ярликом «Пас»', () => {
    wrap(<Menu open onOpenChange={() => undefined} />);
    expect(screen.getByText('Збережи свій Новий рік')).toBeTruthy();
    for (const name of ['Сайт', 'Моє свято', 'Дивитися', 'Ще']) expect(screen.getByRole('heading', { name })).toBeTruthy();
    const href = (name: RegExp) => screen.getByRole('link', { name }).getAttribute('href')?.replace(/\/$/, '');
    expect(href(/Кімната перегляду/)).toBe('/room');
    expect(href(/Режим вечірки/)).toBe('/tv');
    expect(href(/Рейтинг святкувань/)).toBe('/rating');
    expect(screen.getByRole('link', { name: /Мій графік/ }).textContent).toContain('Пас');
    expect(screen.queryByRole('button', { name: 'Вийти' })).toBeNull();
  });

  it('увійшла з пасом: картка зі статусом пасу, «Вийти» виходить з акаунта', () => {
    grantTestPass('olena@gmail.com', 0);
    useGuestStore.setState({ nick: 'Олена' });
    const onOpenChange = vi.fn();
    wrap(<Menu open onOpenChange={onOpenChange} />);
    const card = document.querySelector('[data-block="menu-account"]')!;
    expect(card.textContent).toContain('Олена');
    expect(card.textContent).toContain('Новорічний пас активний');
    expect(screen.getByRole('link', { name: /Мій графік/ }).textContent).not.toContain('Пас');
    fireEvent.click(screen.getByRole('button', { name: 'Вийти' }));
    expect(useAuthStore.getState().user).toBeNull();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('вікно O-MENU (keepOpenOnNavigate): перехід не закриває меню; Radix-варіант — закриває; «Допомога» веде на /help/', () => {
    const onClose = vi.fn();
    const { unmount } = wrap(<MenuBody onClose={onClose} keepOpenOnNavigate />);
    expect(screen.getByRole('link', { name: 'Допомога' }).getAttribute('href')?.replace(/\/$/, '')).toBe('/help');
    fireEvent.click(screen.getByRole('link', { name: /Рейтинг святкувань/ }));
    expect(onClose).not.toHaveBeenCalled();
    unmount();
    const onOpenChange = vi.fn();
    wrap(<Menu open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole('link', { name: /Рейтинг святкувань/ }));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
