import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenTipsWindow } from '@/components/tips/TipsWindow';
import { useChatFeed } from '@/lib/chat-sim/store';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { useTipsStore } from '@/stores/tips';
import { renderPage } from './render';

function HeaderSupport() {
  const open = useOpenTipsWindow();
  return (
    <button type="button" onClick={() => open()}>
      Підтримати (хедер)
    </button>
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  useGuestStore.getState().resetGuest();
  useChatFeed.getState().reset();
  useTipsStore.getState().reset();
  useTestControls.getState().setPayResult('success');
});
afterEach(() => {
  useTestControls.getState().setPayResult('success');
  vi.useRealTimers();
});

describe('вікно «Чайові»: тост під час оплати (варіант B, дошка `Desk-Tips-Toast`, 2026-11-07)', () => {
  it('з хедера — лише суми й «Підтримати $N»; поля email і тосту немає', () => {
    renderPage(<HeaderSupport />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати (хедер)' }));
    const win = screen.getByRole('dialog', { name: 'Чайові' });
    expect(within(win).getAllByRole('radio').map((r) => r.getAttribute('aria-label'))).toEqual(['$2 · келих', '$5 · пляшка ігристого', '$10 · феєрверк']);
    expect(within(win).queryByRole('textbox')).toBeNull();
    expect(win).toHaveTextContent('Тост напишеш, поки оплачуєш');
  });

  it('«Підтримати» → «Поки оплачуєш — напиши тост» → підтверджено → «Опублікувати тост» → тост у чаті', () => {
    useTestControls.getState().setPayResult('pending');
    renderPage(<HeaderSupport />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати (хедер)' }));
    const win = screen.getByRole('dialog', { name: 'Чайові' });
    fireEvent.click(within(win).getByRole('radio', { name: /^\$10/ }));
    fireEvent.click(within(win).getByRole('button', { name: 'Підтримати $10' }));
    expect(win).toHaveTextContent('Чекаємо оплату на PayPro Global');
    expect(win).toHaveTextContent('Поки оплачуєш — напиши тост');
    const field = within(win).getByRole('textbox', { name: 'Текст твого тосту' });
    expect(field).toHaveValue('🥂 Піднімаю келих за всіх, хто зустрічає Новий рік разом!');
    fireEvent.click(within(win).getByRole('button', { name: '🎆 Привіт усьому світу!' }));
    expect(field).toHaveValue('🎆 Привіт усьому світу!');
    fireEvent.change(field, { target: { value: 'За нас!' } });
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    act(() => useTipsStore.getState().confirm());
    const paid = screen.getByRole('dialog', { name: 'Чайові' });
    expect(paid).toHaveTextContent('Оплату підтверджено · $10');
    expect(within(paid).getByRole('textbox', { name: 'Текст твого тосту' })).toHaveValue('За нас!');
    fireEvent.click(within(paid).getByRole('button', { name: /Опублікувати тост/ }));
    expect(screen.getByRole('dialog', { name: 'Чайові' })).toHaveTextContent('Ти робиш це свято можливим');
    expect((useChatFeed.getState().rooms.world ?? []).at(-1)).toMatchObject({ toast: { amount: 10 }, text: 'За нас!' });
  });

  it('посилання в тості не пропускаємо: «Опублікувати» недоступна', () => {
    renderPage(<HeaderSupport />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати (хедер)' }));
    fireEvent.click(within(screen.getByRole('dialog', { name: 'Чайові' })).getByRole('button', { name: 'Підтримати $5' }));
    act(() => {
      vi.advanceTimersByTime(7_000);
    });
    const win = screen.getByRole('dialog', { name: 'Чайові' });
    fireEvent.change(within(win).getByRole('textbox', { name: 'Текст твого тосту' }), { target: { value: 'дивіться www.spam.com' } });
    expect(within(win).getByRole('button', { name: /Опублікувати тост/ })).toBeDisabled();
  });
});
