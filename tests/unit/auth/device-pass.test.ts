/**
 * Пас на пристрої — лише пас акаунта, що увійшов (правка власника 2026-11-10), і «Скинути стан гостя» стирає все.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { usePassStore } from '@/stores/pass';
import { resetDeviceState } from '@/stores/resetDevice';
import { testHasPass } from '@/tests/unit/_support/pass';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);
// Пас — лише з сесії (шов, залишки E5); старе поле `guest.hasPass` зі сховища нічого не вмикає.
const hasPass = testHasPass;
const staleDevicePass = () => useGuestStore.setState({ hasPass: true } as never);

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, devicePass: null, sends: [], passes: {} });
  useGuestStore.getState().resetGuest();
});

describe('пас лише з входом в акаунт з пасом', () => {
  it('вхід Google чи поштою в акаунт без пасу пасу не дає — навіть якщо на пристрої лишився старий', () => {
    staleDevicePass();
    useAuthStore.getState().signInGoogle(T0);
    expect(hasPass()).toBe(false);
    useAuthStore.getState().signOut();
    staleDevicePass();
    useAuthStore.getState().signInVerified('new@example.com', T0);
    expect(hasPass()).toBe(false);
  });

  it('оформлення дає пас; вихід його знімає; вхід в акаунт з пасом — повертає', () => {
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    useAuthStore.getState().grantPass('olena@example.com', T0);
    expect(hasPass()).toBe(true);
    useAuthStore.getState().signOut();
    expect(hasPass()).toBe(false);
    useAuthStore.getState().signInVerified('olena@example.com', T0 + 1);
    expect(hasPass()).toBe(true);
  });

  it('відновлення зі сховища: гість без входу зі старим «пасом на пристрої» — паса немає', () => {
    staleDevicePass();
    expect(hasPass()).toBe(false);
  });
});

describe('«Скинути стан гостя» — увесь стан на пристрої', () => {
  it('стирає вхід, паси акаунтів, гостя, незавершені оплати й усі ключі t2f: у localStorage', () => {
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    useAuthStore.getState().grantPass('olena@example.com', T0);
    useGuestStore.getState().setSchedule(['evt_lisbon_2027']);
    usePassStore.setState({ phase: 'pending', email: 'olena@example.com', pendingSince: T0 });
    localStorage.setItem('t2f:pass-flow:v1', JSON.stringify({ state: { phase: 'pending', email: 'x@y.zz' }, version: 1 }));
    localStorage.setItem('t2f:toast:v1', '{}');
    useAuthStore.getState().grantDevicePass('gift@example.com', T0);

    resetDeviceState();

    expect(useAuthStore.getState()).toMatchObject({ user: null, accounts: [], passes: {}, unclaimed: {}, attached: {}, code: null, devicePass: null });
    expect(hasPass()).toBe(false);
    expect(useGuestStore.getState().schedule).toEqual([]);
    expect(usePassStore.getState().phase).toBe('form');
    expect(Object.keys(localStorage).filter((k) => k.startsWith('t2f:'))).toEqual([]);
  });
});
