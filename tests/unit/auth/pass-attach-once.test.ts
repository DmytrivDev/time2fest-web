/**
 * Пас пристрою приєднується до першого акаунта на цьому пристрої (рішення власника 2026-11-15, замінює правило
 * 2026-11-14 «лише під поштою оплати»): пас гостя (куплений чи подарований до тосту $10) працює на пристрої одразу;
 * перший акаунт, у який ввійшли тут (будь-яка пошта, Google чи код), отримує його раз і назавжди; наступний — ні.
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

describe('пас пристрою: приєднується до першого акаунта на пристрої', () => {
  it('до входу пас ні на чиєму акаунті, але працює на пристрої', () => {
    st().grantDevicePass(PAID, T0);
    expect(passPlace(st())).toBe('device');
    expect(st().passes).toEqual({});
    expect(emailHasPass(st(), PAID)).toBe(true);
  });

  it('перший акаунт з будь-якою поштою отримує пас; запис пристрою зникає', () => {
    st().grantDevicePass(PAID, T0);
    const id = st().devicePass!.id;
    st().signInVerified('other@example.com', T0 + 1);
    expect(st().passes['other@example.com']).toBe(T0);
    expect(st().attached[id]).toBe('other@example.com');
    expect(st().unclaimed[PAID]).toBeUndefined();
    expect(st().devicePass).toBeNull();
    expect(passPlace(st())).toBe('account');
  });

  it('Google теж приєднує; вихід знімає пас акаунта, і наступний акаунт паса вже не отримує', () => {
    st().grantDevicePass(PAID, T0);
    st().signInGoogle(T0 + 1);
    expect(passPlace(st())).toBe('account');
    st().signOut();
    expect(passPlace(st())).toBeNull();
    st().signInVerified('second@example.com', T0 + 2);
    expect(st().passes['second@example.com']).toBeUndefined();
    expect(passPlace(st())).toBeNull();
    st().signOut();
    st().signInGoogle(T0 + 3);
    expect(passPlace(st())).toBe('account');
  });

  it('пошта оплати, поки нікого не ввійшло, нічого не вирішує: пас іде до першого акаунта, навіть не з поштою оплати', () => {
    st().grantDevicePass(PAID, T0);
    st().signInVerified(PAID, T0 + 1);
    expect(st().passes[PAID]).toBe(T0);
    expect(st().devicePass).toBeNull();
  });

  it('акаунт, що вже має власний пас, пас пристрою не забирає: той лишається на пристрої до акаунта без паса', () => {
    st().signInVerified('owner@example.com', T0);
    st().grantPass('owner@example.com', T0);
    st().signOut();
    st().grantDevicePass(PAID, T0 + 5);
    st().signInVerified('owner@example.com', T0 + 6);
    expect(st().devicePass).not.toBeNull();
    expect(st().passes['owner@example.com']).toBe(T0);
    st().signOut();
    st().signInVerified('fresh@example.com', T0 + 7);
    expect(st().passes['fresh@example.com']).toBe(T0 + 5);
    expect(st().devicePass).toBeNull();
  });

  it('приєднаний пас іде за акаунтом після зміни пошти', () => {
    st().grantDevicePass(PAID, T0);
    st().signInVerified('a@example.com', T0 + 1);
    st().changeEmail('renamed@example.com');
    expect(st().passes['renamed@example.com']).toBe(T0);
    expect(st().passes['a@example.com']).toBeUndefined();
  });

  it('подарунок до тосту $10: той, хто увійшов, — на акаунт; гість — на пристрій, далі те саме правило', () => {
    st().signInVerified('olena@example.com', T0);
    expect(st().giftPass(T0, PAID)).toBe('active');
    expect(st().passes['olena@example.com']).toBe(T0);
    st().signOut();
    useAuthStore.setState(AUTH_EMPTY);
    expect(st().giftPass(T0, PAID)).toBe('device');
    expect(st().devicePass?.email).toBe(PAID);
    expect(accountHasPass(st())).toBe(true);
    st().signInGoogle(T0 + 1);
    expect(passPlace(st())).toBe('account');
    expect(st().devicePass).toBeNull();
  });
});

describe('сесія й оплата', () => {
  it('сесія каже, де живе пас: пристрій (гість) або акаунт (після першого входу)', () => {
    const auth = createSimAuth();
    st().grantDevicePass(PAID, T0);
    expect(auth.peek()).toMatchObject({ user: null, hasPass: true, passOn: 'device', passSince: T0, devicePass: { email: PAID, since: T0 } });
    st().signInVerified('other@example.com', T0 + 1);
    expect(auth.peek()).toMatchObject({ user: { email: 'other@example.com' }, hasPass: true, passOn: 'account', passSince: T0, devicePass: null });
  });

  it('оплата паса з пошти, на якій уже є неприєднаний пас, — pass-owned', async () => {
    st().grantDevicePass(PAID, T0);
    useAuthStore.setState({ devicePass: null });
    const res = await createSimCheckout().start({ product: { kind: 'pass' }, email: PAID, returnPath: '/pass/', clientId: 'attach-once' });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatchObject({ code: 'conflict', reason: 'pass-owned' });
  });

  it('міграція сховища версії 2 (через 4): пас пристрою вважається вже приєднаним до пошти оплати', async () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({ state: { user: null, accounts: [], code: null, sends: [], passes: { [PAID]: T0 }, devicePass: { email: PAID, since: T0 }, pendingPassGift: T0 }, version: 2 }),
    );
    await useAuthStore.persist.rehydrate();
    expect(AUTH_VERSION).toBe(4);
    expect(st().devicePass).toMatchObject({ email: PAID, since: T0 });
    expect(st().attached[st().devicePass!.id]).toBe(PAID);
    expect(passPlace(st())).toBe('device');
    st().signInVerified(PAID, T0 + 1);
    expect(st().devicePass).toBeNull();
    expect(passPlace(st())).toBe('account');
  });

  it('міграція версії 3: той, хто вже ввійшов без власного паса, отримує неприєднаний пас пристрою', async () => {
    localStorage.setItem(
      AUTH_STORAGE_KEY,
      JSON.stringify({
        state: {
          user: { email: 'x@example.com', via: 'email', signedInAt: T0 },
          accounts: ['x@example.com'],
          code: null,
          sends: [],
          passes: {},
          unclaimed: { [PAID]: { id: 'pass-v3', since: T0 } },
          attached: {},
          devicePass: { id: 'pass-v3', email: PAID, since: T0 },
        },
        version: 3,
      }),
    );
    await useAuthStore.persist.rehydrate();
    expect(st().passes['x@example.com']).toBe(T0);
    expect(st().devicePass).toBeNull();
    expect(st().unclaimed).toEqual({});
  });
});
