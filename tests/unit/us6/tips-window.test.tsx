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

describe('вікно «Чайові» з хедера (рішення 2026-11-01)', () => {
  it('форма: тост із «Змінити», суми, email для квитанції; без email — помилка, оплату не починаємо', () => {
    renderPage(<HeaderSupport />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати (хедер)' }));
    const win = screen.getByRole('dialog', { name: 'Чайові' });
    expect(win).toHaveTextContent('Твій тост у чаті «Світ»');
    expect(within(win).getAllByRole('radio').map((r) => r.textContent)).toEqual(['$2', '$5', '$10']);
    expect(within(win).getByRole('textbox', { name: 'Email для квитанції' })).toBeInTheDocument();
    expect(within(win).queryByText(/Google/)).toBeNull();
    fireEvent.click(within(win).getByRole('button', { name: 'Змінити' }));
    fireEvent.change(within(win).getByRole('textbox', { name: 'Текст твого тосту' }), { target: { value: 'За нас!' } });
    fireEvent.click(within(win).getByRole('radio', { name: '$10' }));
    fireEvent.click(within(win).getByRole('button', { name: 'Підтримати $10' }));
    expect(win).toHaveTextContent('Введи email — сюди прийде квитанція.');
    expect(useTipsStore.getState().phase).toBe('form');
  });

  it('«Чекаємо підтвердження» → підтверджено: «Дякуємо!» і тост у чаті з введеним текстом', () => {
    useTestControls.getState().setPayResult('pending');
    renderPage(<HeaderSupport />);
    fireEvent.click(screen.getByRole('button', { name: 'Підтримати (хедер)' }));
    const win = screen.getByRole('dialog', { name: 'Чайові' });
    fireEvent.click(within(win).getByRole('button', { name: 'Змінити' }));
    fireEvent.change(within(win).getByRole('textbox', { name: 'Текст твого тосту' }), { target: { value: 'За нас!' } });
    fireEvent.change(within(win).getByRole('textbox', { name: 'Email для квитанції' }), { target: { value: 'olena@example.com' } });
    fireEvent.click(within(win).getByRole('button', { name: 'Підтримати $5' }));
    expect(win).toHaveTextContent('Відкриваємо оплату…');
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(win).toHaveTextContent('Чекаємо підтвердження оплати');
    act(() => useTipsStore.getState().confirm());
    expect(screen.getByRole('dialog', { name: 'Чайові' })).toHaveTextContent('Ти робиш це свято можливим');
    expect(within(screen.getByRole('dialog', { name: 'Чайові' })).getAllByRole('button', { name: 'Закрити' }).length).toBeGreaterThan(0);
    expect((useChatFeed.getState().rooms.world ?? []).at(-1)).toMatchObject({ toast: { amount: 5 }, text: 'За нас!' });
  });
});
