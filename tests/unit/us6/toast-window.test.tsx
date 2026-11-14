/**
 * Вікно «Сказати тост» (дошки `Desk-Toast-New`, `Phone-Toast-New` v2, рішення власника 2026-11-12; замінює вікно
 * «Чайові»): рівні й «що дає», тост до оплати, фільтр на «Оплатити», підпис гостя, оплата, успіх за рівнем, пас у
 * подарунок до тосту за $10.
 */
import { act, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useOpenToastWindow } from '@/components/toast/ToastWindow';
import { useChatFeed } from '@/lib/chat-sim/store';
import { PAY_ROUNDTRIP_MS } from '@/lib/offers/paySim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';
import { TOAST_PAY_MS, useToastStore } from '@/stores/toast';
import { renderPage } from './render';
import { grantTestPass, testHasPass } from '@/tests/unit/_support/pass';

function Opener({ tier }: { tier?: 2 | 5 | 10 }) {
  const open = useOpenToastWindow();
  return (
    <button type="button" onClick={() => open(tier ? { tier } : undefined)}>
      Відкрити тост
    </button>
  );
}

const win = () => screen.getByRole('dialog', { name: 'Сказати тост' });
const payBtn = (price = '$5') => within(win()).getByRole('button', { name: `Оплатити ${price}` });
const field = () => within(win()).getByRole('textbox', { name: 'Текст твого тосту' });
const settle = () =>
  act(() => {
    vi.advanceTimersByTime(PAY_ROUNDTRIP_MS + TOAST_PAY_MS + 10);
  });

beforeEach(() => {
  vi.useFakeTimers();
  useGuestStore.getState().resetGuest();
  useAuthStore.setState({ user: null, accounts: [], code: null, devicePass: null, sends: [], passes: {}, pendingPassGift: null });
  useChatFeed.getState().reset();
  useToastStore.getState().reset();
  useToastStore.setState({ said: [] });
  useTestControls.getState().setPayResult('success');
});
afterEach(() => {
  useTestControls.getState().setPayResult('success');
  useTestControls.getState().setOfflineSimulated(false);
  vi.useRealTimers();
});

describe('вікно «Сказати тост»: крок 1', () => {
  it('рівні з $5 за замовчуванням, «що дає», готова фраза в полі, чипси, правило, підпис, «Оплатити $5 · Скасувати»', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    const w = win();
    expect(within(w).getByRole('radio', { name: '$5 · пляшка ігристого' })).toHaveAttribute('aria-checked', 'true');
    expect(within(w).getByRole('radio', { name: '$10 · феєрверк' })).not.toHaveTextContent('найвигідніше');
    expect(field()).toHaveValue('🥂 За всіх, хто зустрічає разом!');
    expect(within(w).getByRole('button', { name: '🥂 За всіх, хто зустрічає разом!' })).toHaveAttribute('aria-pressed', 'true');
    expect(w).toHaveTextContent('Без посилань — лише слова й емодзі · перевіряємо перед показом');
    expect(within(w).getByText('Підпис у чаті').closest('[data-toast-signature]')).toHaveTextContent('Олена');
    fireEvent.click(within(w).getByRole('button', { name: '✨ Хай 2027 буде мирним' }));
    expect(field()).toHaveValue('✨ Хай 2027 буде мирним');
    expect(payBtn()).toBeEnabled();
    // Текст пишуть до оплати: поки не натиснули «Оплатити», оплата не починається.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });
    expect(useToastStore.getState().phase).toBe('form');
  });

  it('«Скажи тост за $10» відкриває вікно з обраними $10', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener tier={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    expect(within(win()).getByRole('radio', { name: '$10 · феєрверк' })).toHaveAttribute('aria-checked', 'true');
    expect(payBtn('$10')).toBeInTheDocument();
  });

  it('власник пасу: «Новорічний пас у тебе вже є»', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    grantTestPass();
    renderPage(<Opener tier={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    expect(win()).toHaveTextContent('Новорічний пас у тебе вже є');
  });

  it('гість без ніку: «Як підписати тост?» у вікні, «Оплатити» неактивна до дійсного ніку; тост не підписують «Гість»', () => {
    renderPage(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    expect(win()).toHaveTextContent('Як підписати тост?');
    expect(win()).not.toHaveTextContent('Гість');
    expect(payBtn()).toBeDisabled();
    const nick = within(win()).getByRole('textbox', { name: 'Нік для тосту' });
    fireEvent.change(nick, { target: { value: 'З' } });
    expect(payBtn()).toBeDisabled();
    // Нік когось із чату — зайнятий.
    fireEvent.change(nick, { target: { value: 'Олена' } });
    expect(payBtn()).toBeDisabled();
    fireEvent.change(nick, { target: { value: 'Зоряна' } });
    expect(payBtn()).toBeEnabled();
    fireEvent.click(payBtn());
    expect(useGuestStore.getState().nick).toBe('Зоряна');
    expect(useToastStore.getState().phase).toBe('paying');
  });

  it('фільтр на «Оплатити»: посилання підкреслено, «Тост не пройшов перевірку», оплата неактивна, доки текст не змінено', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.change(field(), { target: { value: 'Пишіть мені: t.me/olena_ny 🎉' } });
    // До натискання текст не перевіряємо — кнопка активна.
    expect(payBtn()).toBeEnabled();
    fireEvent.click(payBtn());
    expect(useToastStore.getState().phase).toBe('form');
    expect(within(win()).getByRole('alert')).toHaveTextContent('Тост не пройшов перевірку — зміни текст');
    expect(within(win()).getByRole('alert')).toHaveTextContent('Схоже на посилання.');
    expect(win().querySelector('[data-toast-bad]')).toHaveTextContent('t.me/olena_ny');
    expect(payBtn()).toBeDisabled();
    fireEvent.change(field(), { target: { value: 'Пишіть мені в чаті 🎉' } });
    expect(win().querySelector('[data-toast-bad]')).toBeNull();
    expect(payBtn()).toBeEnabled();
  });
});

describe('оплата й результат', () => {
  it('$5: «Чекаємо оплату на PayPro Global» (тост уже не змінити) → «Тост опубліковано», тост у чаті «Світ»', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.click(payBtn());
    expect(win()).toHaveTextContent('Чекаємо оплату на PayPro Global');
    expect(win()).toHaveTextContent('Тост $5 · пляшка ігристого');
    expect(within(win()).queryByRole('textbox')).toBeNull();
    expect(within(win()).getByRole('button', { name: 'Відкрити оплату' })).toBeInTheDocument();
    settle();
    expect(win()).toHaveTextContent('Тост опубліковано');
    expect(win()).toHaveTextContent('Він уже в чаті «Світ» і закріплений під трансляцією до наступної півночі.');
    expect(win()).toHaveTextContent('закріплено під трансляцією');
    expect((useChatFeed.getState().rooms.world ?? []).at(-1)).toMatchObject({
      toast: { amount: 5 },
      text: '🥂 За всіх, хто зустрічає разом!',
      author: { nick: 'Олена', flagCode: 'UA', isMine: true },
    });
    expect(useToastStore.getState().said).toHaveLength(1);
  });

  it('$2: «Він уже в чаті «Світ» — його бачать усі»; без позначки «закріплено»', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener tier={2} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.click(payBtn('$2'));
    settle();
    expect(win()).toHaveTextContent('Він уже в чаті «Світ» — його бачать усі, хто зараз дивиться.');
    expect(win().querySelector('[data-toast-meta]')).toBeNull();
  });

  it('«Оплата не пройшла»: тост збережено, «Спробувати ще — $5»; немає з’єднання — «Немає з’єднання»', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    useTestControls.getState().setPayResult('declined');
    renderPage(<Opener />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.click(payBtn());
    settle();
    expect(win()).toHaveTextContent('Оплата не пройшла');
    expect(win()).toHaveTextContent('Тост збережено — писати знову не треба');
    expect(useChatFeed.getState().rooms.world ?? []).toHaveLength(0);
    useTestControls.getState().setPayResult('success');
    useTestControls.getState().setOfflineSimulated(true);
    fireEvent.click(within(win()).getByRole('button', { name: 'Спробувати ще — $5' }));
    expect(win()).toHaveTextContent('Немає з’єднання');
  });

  it('$10 гостя: «Новорічний пас — подарунок до тосту», «Увійти й активувати пас»; пас чекає входу', () => {
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener tier={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.click(payBtn('$10'));
    settle();
    expect(win()).toHaveTextContent('а твій нік — у привітанні опівночі');
    expect(win()).toHaveTextContent('закріплено·у привітанні опівночі');
    const gift = win().querySelector('[data-toast-gift="pending"]') as HTMLElement;
    expect(gift).toHaveTextContent('Новорічний пас — подарунок до тосту');
    expect(within(gift).getByRole('button', { name: 'Увійти й активувати пас' })).toBeInTheDocument();
    expect(useAuthStore.getState().pendingPassGift).toBeTypeOf('number');
    expect(testHasPass()).toBe(false);
  });

  it('$10 того, хто увійшов: «Пас активний», пас — на акаунті', () => {
    useAuthStore.getState().signInVerified('olena@example.com', Date.now());
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    renderPage(<Opener tier={10} />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити тост' }));
    fireEvent.click(payBtn('$10'));
    settle();
    expect(win().querySelector('[data-toast-gift="active"]')).toHaveTextContent('Пас активний');
    expect(useAuthStore.getState().passes['olena@example.com']).toBeDefined();
    expect(testHasPass()).toBe(true);
  });
});
