/**
 * Незавершена оплата переживає перезавантаження (перевірка сайту 2026-11-09, A-1): пас і чайові.
 * «Перезавантаження» тут — стан у пам’яті скинуто, а в `localStorage` лишився запис до скидання; далі відновлення.
 */
import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PAY_ROUNDTRIP_MS } from '@/lib/offers/paySim';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { PASS_FLOW_STORAGE_KEY, resumePassFlow, usePassStore } from '@/stores/pass';
import { resumeTipsFlow, TIPS_FLOW_STORAGE_KEY, useTipsStore } from '@/stores/tips';
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
    useTipsStore.getState().reset();
    useTestControls.getState().setPayResult('success');
  });
  afterEach(() => vi.useRealTimers());

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

  it('чайові: оплачений тост відновлюється разом із сумою й текстом', async () => {
    useTipsStore.getState().setAmount(10);
    useTipsStore.getState().setToast('З Новим роком!');
    useTipsStore.getState().pay();
    act(() => vi.advanceTimersByTime(60_000));
    expect(useTipsStore.getState().phase).toBe('paid');

    reload(TIPS_FLOW_STORAGE_KEY, () => useTipsStore.getState().reset());
    expect(useTipsStore.getState().phase).toBe('form');
    await resumeTipsFlow();
    expect(useTipsStore.getState()).toMatchObject({ phase: 'paid', amount: 10, toast: 'З Новим роком!' });
    expect(useTipsStore.getState().paidAt).toBeTypeOf('number');
  });

  it('чайові: перехід на оплату перервано — після відновлення оплата доходить до «оплачено»', async () => {
    useTipsStore.getState().pay();
    expect(useTipsStore.getState().phase).toBe('paying');
    reload(TIPS_FLOW_STORAGE_KEY, () => useTipsStore.getState().reset());
    await resumeTipsFlow();
    expect(useTipsStore.getState().phase).toBe('paying');
    act(() => vi.advanceTimersByTime(PAY_ROUNDTRIP_MS));
    expect(useTipsStore.getState().phase).toBe('paid');
  });
});
