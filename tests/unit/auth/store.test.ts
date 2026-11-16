import { beforeEach, describe, expect, it } from 'vitest';
import { CODE_MAX_ATTEMPTS, CODE_TTL_MS, isEmail, RESEND_GAP_MS, SEND_LIMIT, SEND_WINDOW_MS } from '@/lib/auth/sim';
import { clearReturn, rememberReturn, returnPath } from '@/lib/auth/returnTo';
import { accountHasPass, useAuthStore } from '@/stores/auth';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);
const st = () => useAuthStore.getState();

function reset() {
  useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null });
}

describe('вхід (імітація): лише код із 6 цифр (рішення 2026-11-13)', () => {
  beforeEach(reset);

  it('код: 6 цифр, лише перевірка — без входу, доки код не введено', () => {
    expect(st().requestCode(' Olena@Example.com ', 'signin', 'signin', T0)).toEqual({ ok: true });
    const c = st().code!;
    expect(c).toMatchObject({ email: 'olena@example.com', purpose: 'signin', attempts: 0, used: false });
    expect(c.code).toMatch(/^\d{6}$/);
    expect(st().user).toBeNull();
    // Вставка з пробілом теж працює; вхід — окремим примітивом.
    expect(st().checkCode('olena@example.com', `${c.code.slice(0, 3)} ${c.code.slice(3)}`, 'signin', T0 + 1000)).toEqual({ ok: true, email: 'olena@example.com' });
    expect(st().code?.used).toBe(true);
    expect(st().signInVerified('olena@example.com', T0 + 1000)).toEqual({ ok: true, isNew: true, email: 'olena@example.com' });
  });

  it('неправильний код — спроби лишаються; 5-та невдала — код згорів', () => {
    st().requestCode('a@b.co', 'signin', 'signin', T0);
    const wrong = st().code!.code === '000000' ? '111111' : '000000';
    for (let i = 1; i < CODE_MAX_ATTEMPTS; i++) expect(st().checkCode('a@b.co', wrong, 'signin', T0)).toEqual({ ok: false, reason: 'wrong-code', attemptsLeft: CODE_MAX_ATTEMPTS - i });
    expect(st().checkCode('a@b.co', wrong, 'signin', T0)).toEqual({ ok: false, reason: 'too-many-attempts' });
    // Навіть правильний код після цього не діє.
    expect(st().checkCode('a@b.co', st().code!.code, 'signin', T0)).toEqual({ ok: false, reason: 'too-many-attempts' });
  });

  it('код діє 10 хвилин і раз; чужа адреса чи інша мета — «прострочений»', () => {
    st().requestCode('a@b.co', 'signin', 'signin', T0);
    const { code } = st().code!;
    expect(st().checkCode('a@b.co', code, 'signin', T0 + CODE_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(st().checkCode('x@y.co', code, 'signin', T0)).toEqual({ ok: false, reason: 'expired' });
    expect(st().checkCode('a@b.co', code, 'email-change', T0)).toEqual({ ok: false, reason: 'expired' });
    expect(st().checkCode('a@b.co', code, 'signin', T0)).toMatchObject({ ok: true });
    expect(st().checkCode('a@b.co', code, 'signin', T0)).toEqual({ ok: false, reason: 'expired' });
  });

  it('новий код — не частіше ніж раз на 30 с; 6-й за 10 хвилин — «забагато»', () => {
    expect(st().requestCode('a@b.co', 'signin', 'signin', T0)).toEqual({ ok: true });
    expect(st().requestCode('a@b.co', 'signin', 'signin', T0 + 1000)).toEqual({ ok: false, reason: 'wait', until: T0 + RESEND_GAP_MS });
    for (let i = 1; i < SEND_LIMIT; i++) expect(st().requestCode('a@b.co', 'signin', 'signin', T0 + i * RESEND_GAP_MS)).toEqual({ ok: true });
    expect(st().requestCode('a@b.co', 'signin', 'signin', T0 + SEND_LIMIT * RESEND_GAP_MS)).toEqual({ ok: false, reason: 'too-many', until: T0 + SEND_WINDOW_MS });
    expect(st().requestCode('a@b.co', 'signin', 'signin', T0 + SEND_WINDOW_MS)).toEqual({ ok: true });
  });

  it('новий код замінює попередній; тестове «прострочити»', () => {
    st().requestCode('a@b.co', 'signin', 'signin', T0);
    const first = st().code!.code;
    st().requestCode('a@b.co', 'signin', 'signin', T0 + RESEND_GAP_MS);
    if (st().code!.code !== first) expect(st().checkCode('a@b.co', first, 'signin', T0 + RESEND_GAP_MS)).toMatchObject({ ok: false, reason: 'wrong-code' });
    st().expireCode();
    expect(st().checkCode('a@b.co', st().code!.code, 'signin', T0 + RESEND_GAP_MS)).toEqual({ ok: false, reason: 'expired' });
  });

  it('Google — одразу вхід', () => {
    expect(st().signInGoogle(T0)).toMatchObject({ ok: true, isNew: true, email: 'you@gmail.com' });
  });

  it('пас гостя на пристрої: працює одразу, вхід з тією ж поштою робить його пасом акаунта', () => {
    st().grantDevicePass('Olena@Example.com', T0);
    expect(st().devicePass).toMatchObject({ email: 'olena@example.com', since: T0 });
    // До входу пас ще не належить жодному акаунту — чекає першого входу з поштою оплати.
    expect(st().passes['olena@example.com']).toBeUndefined();
    expect(st().unclaimed['olena@example.com']).toMatchObject({ id: st().devicePass!.id, since: T0 });
    expect(accountHasPass(st())).toBe(true);
    st().signInVerified('olena@example.com', T0 + 1);
    expect(st().devicePass).toBeNull();
    expect(accountHasPass(st())).toBe(true);
    st().signOut();
    expect(accountHasPass(st())).toBe(false);
  });

  it('пас пристрою переходить до першого акаунта, навіть коли ввійшли іншою поштою', () => {
    st().grantDevicePass('olena@example.com', T0);
    st().signInGoogle(T0 + 1);
    expect(st().devicePass).toBeNull();
    expect(accountHasPass(st())).toBe(true);
  });
});

describe('email і повернення', () => {
  it('перевірка email', () => {
    expect(isEmail('olena@example.com')).toBe(true);
    expect(isEmail('olena@example')).toBe(false);
    expect(isEmail('olena example.com')).toBe(false);
    expect(isEmail('')).toBe(false);
  });

  it('повернення лише на свої сторінки, не на вхід', () => {
    clearReturn();
    expect(returnPath()).toBe('/');
    rememberReturn('/country/velyka-brytaniia/');
    expect(returnPath()).toBe('/country/velyka-brytaniia/');
    rememberReturn('/login/');
    rememberReturn('//evil.example');
    expect(returnPath()).toBe('/country/velyka-brytaniia/');
  });
});
