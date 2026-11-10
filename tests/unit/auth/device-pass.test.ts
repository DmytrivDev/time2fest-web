/**
 * Пас на пристрої — лише пас акаунта, що увійшов (правка власника 2026-11-10), і «Скинути стан гостя» стирає все.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { syncDevicePass, useAuthStore } from '@/stores/auth';
import { useFirstRowStore } from '@/stores/firstRow';
import { useGuestStore } from '@/stores/guest';
import { usePassStore } from '@/stores/pass';
import { resetDeviceState } from '@/stores/resetDevice';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);
const hasPass = () => useGuestStore.getState().hasPass;

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {} });
  useGuestStore.getState().resetGuest();
});

describe('пас лише з входом в акаунт з пасом', () => {
  it('вхід Google чи поштою в акаунт без пасу пасу не дає — навіть якщо на пристрої лишився старий', () => {
    useGuestStore.getState().setHasPass(true);
    useAuthStore.getState().signInGoogle(T0);
    expect(hasPass()).toBe(false);
    useAuthStore.getState().signOut();
    useGuestStore.getState().setHasPass(true);
    useAuthStore.getState().emailSignIn('new@example.com', 'signin', T0);
    expect(hasPass()).toBe(false);
  });

  it('оформлення дає пас; вихід його знімає; вхід в акаунт з пасом — повертає', () => {
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0);
    useAuthStore.getState().grantPass('olena@example.com', T0);
    expect(hasPass()).toBe(true);
    useAuthStore.getState().signOut();
    expect(hasPass()).toBe(false);
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0 + 1);
    expect(hasPass()).toBe(true);
  });

  it('відновлення зі сховища: гість без входу з «пасом на пристрої» — пас знімається', () => {
    useGuestStore.getState().setHasPass(true);
    syncDevicePass();
    expect(hasPass()).toBe(false);
  });
});

describe('«Скинути стан гостя» — увесь стан на пристрої', () => {
  it('стирає вхід, паси акаунтів, гостя, незавершені оплати й усі ключі t2f: у localStorage', () => {
    useAuthStore.getState().signInWithPurchase('olena@example.com', T0);
    useAuthStore.getState().grantPass('olena@example.com', T0);
    useGuestStore.getState().setSchedule(['evt_lisbon_2027']);
    useFirstRowStore.getState().markPassGifted();
    usePassStore.setState({ phase: 'pending', email: 'olena@example.com', pendingSince: T0 });
    localStorage.setItem('t2f:pass-flow:v1', JSON.stringify({ state: { phase: 'pending', email: 'x@y.zz' }, version: 1 }));
    localStorage.setItem('t2f:tips-flow:v1', '{}');

    resetDeviceState();

    expect(useAuthStore.getState()).toMatchObject({ user: null, accounts: [], passes: {}, letter: null });
    expect(hasPass()).toBe(false);
    expect(useGuestStore.getState().schedule).toEqual([]);
    expect(useFirstRowStore.getState().passGifted).toBe(false);
    expect(usePassStore.getState().phase).toBe('form');
    expect(Object.keys(localStorage).filter((k) => k.startsWith('t2f:'))).toEqual([]);
  });
});
