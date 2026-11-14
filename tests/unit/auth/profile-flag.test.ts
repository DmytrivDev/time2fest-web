/**
 * Прапор профілю заданий одразу (правка власника 2026-11-10): кожен вхід і створення акаунта — пас на `/pass/`,
 * Google, пошта, посилання з листа — задає прапор за IP (`detectFlag` → 'UA'), якщо людина ще не обрала свій.
 * Раніше після оформлення пасу аватар у шапці був літерою без прапора.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);
const flag = () => useGuestStore.getState().flagCode;

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, devicePass: null, sends: [], passes: {} });
  useGuestStore.getState().resetGuest();
});

describe('прапор профілю — одразу після входу', () => {
  it('оформлення пасу зі створенням акаунта (`signInWithPurchase`)', () => {
    expect(flag()).toBeUndefined();
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    expect(flag()).toBe('UA');
    expect(useGuestStore.getState().detectedFlag).toBe('UA');
  });

  it('Google, пошта (новий акаунт) і код із листа', () => {
    useAuthStore.getState().signInGoogle(T0);
    expect(flag()).toBe('UA');

    useAuthStore.getState().signOut();
    useGuestStore.getState().resetGuest();
    useAuthStore.getState().signInVerified('new@example.com', T0);
    expect(flag()).toBe('UA');

    useAuthStore.getState().signOut();
    useGuestStore.getState().resetGuest();
    // Код надіслано — прапора ще немає; введено — вхід із прапором.
    expect(useAuthStore.getState().requestCode('new@example.com', 'signin', 'signin', T0 + 120_000)).toEqual({ ok: true });
    expect(flag()).toBeUndefined();
    const res = useAuthStore.getState().checkCode('new@example.com', useAuthStore.getState().code!.code, 'signin', T0 + 121_000);
    expect(res).toMatchObject({ ok: true });
    useAuthStore.getState().signInVerified('new@example.com', T0 + 121_000);
    expect(flag()).toBe('UA');
  });

  it('обраний прапор не перезаписується', () => {
    useGuestStore.getState().setFlag('PL');
    useAuthStore.getState().signInGoogle(T0);
    expect(flag()).toBe('PL');
  });

  it('прапор задано вже в мить, коли з’являється користувач (шапка без затримки)', () => {
    let seen: string | undefined = 'none';
    const unsub = useAuthStore.subscribe((s, prev) => {
      if (s.user && !prev.user) seen = useGuestStore.getState().flagCode;
    });
    useAuthStore.getState().signInVerified('olena@example.com', T0);
    unsub();
    expect(seen).toBe('UA');
  });
});
