/**
 * Пас приєднується до акаунта лише раз (рішення власника 2026-11-14): пас гостя (куплений чи подарований до тосту $10)
 * працює на пристрої одразу; до акаунта він приєднується один раз — до першого, у який увійшли з поштою оплати (код чи
 * Google, будь-який пристрій). Вхід тут з іншою поштою пас пристрою не забирає й не переносить; приєднаний пас іде за
 * акаунтом і до іншого акаунта вже не перейде.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { createSimAuth } from '@/lib/api/sim/auth';
import { createSimCheckout } from '@/lib/api/sim/checkout';
import { AUTH_EMPTY, AUTH_STORAGE_KEY, AUTH_VERSION, accountHasPass, emailHasPass, passPlace, useAuthStore } from '@/stores/auth';

const T0 = Date.UTC(2026, 11, 31, 20, 0, 0);
const st = () => useAuthStore.getState();
const PAID = 'paid@example.com';

beforeEach(() => {
  useAuthStore.setState(AUTH_EMPTY);
});

describe('пас гостя: приєднання до акаунта лише раз', () => {
  it('до входу пас ні на чиєму акаунті, але працює на пристрої', () => {
    st().grantDevicePass(PAID, T0);
    expect(passPlace(st())).toBe('device');
    expect(st().passes).toEqual({});
    expect(emailHasPass(st(), PAID)).toBe(true);
  });

  it('вхід тут з іншою поштою: пас працює на пристрої, але до того акаунта не переходить; вихід його не забирає', () => {
    st().grantDevicePass(PAID, T0);
    st().signInVerified('other@example.com', T0 + 1);
    expect(passPlace(st())).toBe('device');
    expect(st().passes['other@example.com']).toBeUndefined();
    expect(st().unclaimed[PAID]).toBeDefined();
    st().signOut();
    expect(passPlace(st())).toBe('device');
  });

  it('перший вхід з поштою оплати приєднує пас: на пристрої оплати він стає пасом акаунта', () => {
    st().grantDevicePass(PAID, T0);
    const id = st().devicePass!.id;
    st().signInVerified(PAID, T0 + 1);
    expect(st().passes[PAID]).toBe(T0);
    expect(st().attached[id]).toBe(PAID);
    expect(st().unclaimed[PAID]).toBeUndefined();
    expect(st().devicePass).toBeNull();
    expect(passPlace(st())).toBe('account');
  });

  it('приєднаний пас іде за акаунтом: після зміни пошти новий акаунт зі старою адресою паса не отримує', () => {
    st().grantDevicePass(PAID, T0);
    // Пристрій оплати лишається гостем; акаунт з поштою оплати входить «на іншому пристрої» (той самий «сервер»).
    const device = st().devicePass;
    st().signInVerified(PAID, T0 + 1);
    useAuthStore.setState({ devicePass: device });
    st().changeEmail('renamed@example.com');
    expect(st().passes['renamed@example.com']).toBe(T0);
    expect(st().passes[PAID]).toBeUndefined();
    st().signOut();
    // Новий акаунт з тією самою адресою оплати — пас уже приєднано, вдруге не приєднується.
    st().signInVerified(PAID, T0 + 2);
    expect(st().passes[PAID]).toBeUndefined();
    // А пас пристрою оплати лишається на пристрої: цей акаунт — не той, до якого він приєднався.
    expect(st().devicePass?.email).toBe(PAID);
    expect(passPlace(st())).toBe('device');
    // Вхід у той акаунт, до якого пас приєднався (тепер з новою поштою), — пас акаунта.
    st().signInVerified('renamed@example.com', T0 + 3);
    expect(st().devicePass).toBeNull();
    expect(passPlace(st())).toBe('account');
  });

  it('пошта оплати вже має пас акаунта: пристрій користується ним, другого паса не з’являється', () => {
    st().signInVerified(PAID, T0);
    st().grantPass(PAID, T0);
    st().signOut();
    st().grantDevicePass(PAID, T0 + 5);
    expect(st().devicePass).toMatchObject({ email: PAID, since: T0 });
    expect(st().unclaimed).toEqual({});
    st().signInVerified(PAID, T0 + 6);
    expect(st().devicePass).toBeNull();
    expect(st().passes[PAID]).toBe(T0);
  });

  it('подарунок до тосту $10: той, хто увійшов, — на акаунт; гість — на пристрій із поштою оплати, далі те саме правило', () => {
    st().signInVerified('olena@example.com', T0);
    expect(st().giftPass(T0, PAID)).toBe('active');
    expect(st().passes['olena@example.com']).toBe(T0);
    st().signOut();
    useAuthStore.setState(AUTH_EMPTY);
    expect(st().giftPass(T0, PAID)).toBe('device');
    expect(st().devicePass?.email).toBe(PAID);
    expect(accountHasPass(st())).toBe(true);
    st().signInGoogle(T0 + 1);
    expect(passPlace(st())).toBe('device');
  });
});

describe('сесія й оплата', () => {
  it('сесія каже, де живе пас: пристрій (гість чи інший акаунт) або акаунт', () => {
    const auth = createSimAuth();
    st().grantDevicePass(PAID, T0);
    expect(auth.peek()).toMatchObject({ user: null, hasPass: true, passOn: 'device', passSince: T0, devicePass: { email: PAID, since: T0 } });
    st().signInVerified('other@example.com', T0 + 1);
    expect(auth.peek()).toMatchObject({ user: { email: 'other@example.com' }, hasPass: true, passOn: 'device', devicePass: { email: PAID } });
    st().signOut();
    st().signInVerified(PAID, T0 + 2);
    expect(auth.peek()).toMatchObject({ user: { email: PAID }, hasPass: true, passOn: 'account', passSince: T0, devicePass: null });
  });

  it('оплата паса з пошти, на якій уже є неприєднаний пас, — pass-owned', async () => {
    st().grantDevicePass(PAID, T0);
    useAuthStore.setState({ devicePass: null });
    const res = await createSimCheckout().start({ product: { kind: 'pass' }, email: PAID, returnPath: '/pass/', clientId: 'attach-once' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ code: 'conflict', reason: 'pass-owned' });
  });

  it('міграція сховища версії 2: пас пристрою вважається вже приєднаним до пошти оплати', async () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ state: { user: null, accounts: [], code: null, sends: [], passes: { [PAID]: T0 }, devicePass: { email: PAID, since: T0 }, pendingPassGift: T0 }, version: 2 }),
    );
    await useAuthStore.persist.rehydrate();
    expect(AUTH_VERSION).toBe(3);
    expect(st().devicePass).toMatchObject({ email: PAID, since: T0 });
    expect(st().attached[st().devicePass!.id]).toBe(PAID);
    expect(passPlace(st())).toBe('device');
    st().signInVerified(PAID, T0 + 1);
    expect(st().devicePass).toBeNull();
    expect(passPlace(st())).toBe('account');
  });
});
