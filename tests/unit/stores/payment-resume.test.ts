/**
 * Незавершена оплата переживає перезавантаження (перевірка сайту 2026-11-09, A-1): пас і тост (був «чайові», 2026-11-12).
 * «Перезавантаження» тут — стан у пам’яті скинуто, а в `localStorage` лишився запис до скидання; далі відновлення.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reloadSimCheckoutForTest, resumeOpenOrders } from '@/lib/api/sim/checkout';
import { PAY_ROUNDTRIP_MS } from '@/lib/offers/paySim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { PASS_FLOW_STORAGE_KEY, resumePassFlow, usePassStore } from '@/stores/pass';
import { resumeToastFlow, setToastClock, TOAST_STORAGE_KEY, useToastStore } from '@/stores/toast';
import { useTestControls } from '@/stores/testControls';

const T0 = Date.UTC(2026, 11, 31, 20, 0, 0);

/** Скинути стан у пам’яті, лишивши в сховищі те, що там було до скидання. */
function reload(key: string, resetMemory: () => void): void {
  const raw = window.localStorage.getItem(key);
  resetMemory();
  if (raw === null) window.localStorage.removeItem(key);
  else window.localStorage.setItem(key, raw);
}

function stored(key: string): Record<string, unknown> {
  return (JSON.parse(window.localStorage.getItem(key) ?? '{}') as { state?: Record<string, unknown> }).state ?? {};
}

describe('незавершена оплата переживає перезавантаження', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    window.localStorage.clear();
    useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {} });
    useGuestStore.getState().setHasPass(false);
    usePassStore.getState().reset();
    useToastStore.getState().reset();
    useToastStore.setState({ said: [] });
    setToastClock(() => Date.now());
    // Тост підписують ніком (рішення 2026-11-12).
    useGuestStore.setState({ nick: 'Олена', flagCode: 'UA' });
    useTestControls.getState().setPayResult('success');
  });
  afterEach(() => {
    useTestControls.getState().setPayResult('success');
    vi.useRealTimers();
  });

  it('пас: перехід на оплату перервано — після відновлення оплата доходить до «Пас активний», без другої оплати', async () => {
    useAuthStore.getState().signInGoogle(T0);
    usePassStore.getState().pay();
    expect(usePassStore.getState().phase).toBe('opening');
    expect(stored(PASS_FLOW_STORAGE_KEY).phase).toBe('opening');

    reload(PASS_FLOW_STORAGE_KEY, () => usePassStore.getState().reset());
    expect(usePassStore.getState().phase).toBe('form');
    await resumePassFlow();
    expect(usePassStore.getState().phase).toBe('opening');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(usePassStore.getState().phase).toBe('success');
    expect(useGuestStore.getState().hasPass).toBe(true);
    // Після результату в сховищі — лише «форма», без email.
    expect(stored(PASS_FLOW_STORAGE_KEY)).toEqual({ phase: 'form', email: '' });
  });

  it('пас гостя: «Чекаємо підтвердження» з email відновлюється й підтверджується на ту саму адресу', async () => {
    useTestControls.getState().setPayResult('pending');
    usePassStore.getState().setEmail('olena@example.com');
    usePassStore.getState().submitEmail();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(usePassStore.getState().phase).toBe('pending');
    expect(stored(PASS_FLOW_STORAGE_KEY)).toMatchObject({ phase: 'pending', email: 'olena@example.com' });

    reload(PASS_FLOW_STORAGE_KEY, () => usePassStore.getState().reset());
    await resumePassFlow();
    expect(usePassStore.getState().phase).toBe('pending');
    expect(usePassStore.getState().pendingSince).toBeTypeOf('number');
    usePassStore.getState().confirm();
    expect(usePassStore.getState().phase).toBe('success');
    expect(useAuthStore.getState().passes['olena@example.com']).toBeDefined();
  });

  it('пас: «Оплата не пройшла» не зберігається — після перезавантаження звичайна форма', async () => {
    useTestControls.getState().setPayResult('declined');
    useAuthStore.getState().signInGoogle(T0);
    usePassStore.getState().pay();
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(usePassStore.getState().phase).toBe('failed');
    reload(PASS_FLOW_STORAGE_KEY, () => usePassStore.getState().reset());
    await resumePassFlow();
    expect(usePassStore.getState().phase).toBe('form');
  });

  // Чайові стали тостом (рішення 2026-11-12): тост публікується, щойно оплату підтвердили, — окремого «оплачено» немає.
  it('тост: «чекаємо підтвердження» відновлюється разом із рівнем і текстом і підтверджується', async () => {
    useTestControls.getState().setPayResult('pending');
    useToastStore.getState().setTier(10);
    useToastStore.getState().setText('З Новим роком!');
    useToastStore.getState().pay();
    act(() => vi.advanceTimersByTime(60_000));
    expect(useToastStore.getState()).toMatchObject({ phase: 'paying', tier: 10 });
    expect(useToastStore.getState().pendingSince).toBeTypeOf('number');

    reload(TOAST_STORAGE_KEY, () => useToastStore.getState().reset());
    expect(useToastStore.getState().phase).toBe('form');
    await resumeToastFlow();
    expect(useToastStore.getState()).toMatchObject({ phase: 'paying', tier: 10, text: 'З Новим роком!' });
    expect(useToastStore.getState().pendingSince).toBeTypeOf('number');
    useToastStore.getState().confirm();
    expect(useToastStore.getState().phase).toBe('success');
  });

  it('тост: перехід на оплату перервано — після відновлення оплата доходить до «Тост опубліковано»', async () => {
    useToastStore.getState().setText('За всіх!');
    useToastStore.getState().pay();
    expect(useToastStore.getState().phase).toBe('paying');
    // Перезавантаження вкладки: і вікно, і процес оплати (шов E4) — з нуля; «сервер» імітації продовжує перерваний перехід.
    reload(TOAST_STORAGE_KEY, () => {
      useToastStore.getState().reset();
      reloadSimCheckoutForTest();
    });
    await resumeToastFlow();
    resumeOpenOrders();
    expect(useToastStore.getState().phase).toBe('paying');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(useToastStore.getState().phase).toBe('success');
    expect(useToastStore.getState().said.at(-1)).toMatchObject({ text: 'За всіх!', tier: 5 });
  });
});
