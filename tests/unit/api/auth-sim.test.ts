/** Шов: адаптери `sim` входу й профілю — тонкі обгортки над сторами; пошта — лише кодом (рішення 2026-11-13). */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createSimAuth } from '@/lib/api/sim/auth';
import { createSimProfile } from '@/lib/api/sim/profile';
import { authCodeError } from '@/lib/api/contracts/auth';
import { authSession, useHasPass, useSession } from '@/lib/api/hooks/auth';
import { CODE_MAX_ATTEMPTS, GOOGLE_DELAY_MS, RESEND_GAP_MS } from '@/lib/auth/sim';
import { useAccountStore } from '@/stores/account';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

const signIn = (email: string, now: number) => useAuthStore.getState().signInVerified(email, now);
const lastCode = () => useAuthStore.getState().code!.code;
const wrongOf = (c: string) => (c === '000000' ? '111111' : '000000');

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], code: null, sends: [], passes: {}, devicePass: null, pendingPassGift: null });
  useTestControls.setState({ authUnavailable: false, googleCancelled: false });
});
afterEach(() => vi.useRealTimers());

describe('sim-адаптер входу', () => {
  it('код: нова адреса — вхід лише після коду (акаунт створено); наявна — так само', async () => {
    const svc = createSimAuth();
    const sent = await svc.requestCode(' New@Example.com ', 'signup');
    expect(sent.ok && sent.value).toMatchObject({ email: 'new@example.com', attemptsLeft: CODE_MAX_ATTEMPTS });
    expect(sent.ok && sent.value.resendAt - sent.value.sentAt).toBe(RESEND_GAP_MS);
    expect(useAuthStore.getState().user).toBeNull();
    expect(svc.peek()?.code?.email).toBe('new@example.com');
    expect(await svc.verifyCode('new@example.com', lastCode())).toEqual({ ok: true, value: { isNew: true, email: 'new@example.com' } });
    expect(svc.peek()?.code).toBeNull();
    await svc.signOut();
    useAuthStore.setState({ sends: [] });
    await svc.requestCode('new@example.com', 'signin');
    expect(useAuthStore.getState().user).toBeNull();
    expect(await svc.verifyCode('new@example.com', lastCode())).toEqual({ ok: true, value: { isNew: false, email: 'new@example.com' } });
  });

  it('помилки коду: wrong-code зі спробами, too-many-attempts, expired; authCodeError їх розрізняє', async () => {
    const svc = createSimAuth();
    await svc.requestCode('a@b.co', 'signin');
    const wrong = wrongOf(lastCode());
    const first = await svc.verifyCode('a@b.co', wrong);
    expect(first).toEqual({ ok: false, error: { code: 'validation', reason: 'wrong-code', attemptsLeft: CODE_MAX_ATTEMPTS - 1 } });
    if (!first.ok) expect(authCodeError(first.error)).toBe('wrong-code');
    for (let i = 2; i < CODE_MAX_ATTEMPTS; i++) await svc.verifyCode('a@b.co', wrong);
    const burnt = await svc.verifyCode('a@b.co', wrong);
    expect(!burnt.ok && authCodeError(burnt.error)).toBe('too-many-attempts');
    useAuthStore.setState({ sends: [] });
    await svc.requestCode('a@b.co', 'signin');
    svc.devCode!.expire();
    const old = await svc.verifyCode('a@b.co', lastCode());
    expect(!old.ok && authCodeError(old.error)).toBe('expired');
  });

  it('ліміт кодів → rate_limited (wait — відлік; сервіс недоступний → unavailable)', async () => {
    const svc = createSimAuth();
    await svc.requestCode('a@b.co', 'signin');
    const wait = await svc.requestCode('a@b.co', 'signin');
    expect(wait.ok).toBe(false);
    if (!wait.ok) {
      expect(wait.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
      expect(authCodeError(wait.error)).toBe('cooldown');
      expect(wait.error.retryAfterMs).toBeGreaterThan(RESEND_GAP_MS - 1000);
    }
    useTestControls.setState({ authUnavailable: true });
    expect(await svc.requestCode('x@y.co', 'signin')).toEqual({ ok: false, error: { code: 'unavailable' } });
    expect(await svc.verifyCode('x@y.co', '123456')).toEqual({ ok: false, error: { code: 'unavailable' } });
  });

  it('тестова пошта: код видно лише через devCode', async () => {
    const svc = createSimAuth();
    await svc.requestCode('a@b.co', 'signin');
    expect(svc.devCode!.get()).toMatchObject({ email: 'a@b.co', code: lastCode(), purpose: 'signin', used: false });
    expect(svc.devCode!.get()).toBe(svc.devCode!.get());
  });

  it('Google: вхід після затримки; скасування до кінця — входу немає', async () => {
    vi.useFakeTimers();
    const svc = createSimAuth();
    const run = new AbortController();
    const cancelled = svc.google({ returnPath: '/', signal: run.signal });
    run.abort();
    expect(await cancelled).toEqual({ ok: false, error: { code: 'conflict', reason: 'cancelled' } });
    vi.advanceTimersByTime(GOOGLE_DELAY_MS);
    expect(useAuthStore.getState().user).toBeNull();
    const done = svc.google({ returnPath: '/' });
    vi.advanceTimersByTime(GOOGLE_DELAY_MS);
    expect(await done).toMatchObject({ ok: true, value: { kind: 'signed-in', email: 'you@gmail.com' } });
    expect((await svc.session()).ok && (await svc.session())).toMatchObject({ value: { user: { via: 'google', name: 'Олена Коваленко' } } });
  });

  it('сесія: пас — з акаунта (а не з пристрою); підписка бачить вхід і пас', async () => {
    const svc = createSimAuth();
    const seen: boolean[] = [];
    const off = svc.subscribe((s) => seen.push(s.hasPass));
    signIn('Olena@Example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    off();
    expect(seen.at(-1)).toBe(true);
    expect(svc.peek()).toMatchObject({ user: { email: 'olena@example.com' }, hasPass: true, passSince: 2 });
    expect(svc.peek()).toBe(svc.peek());
  });
});

describe('пас гостя на пристрої (рішення 2026-11-13)', () => {
  it('гість після оплати: пас на пристрої без входу; вхід з тією ж поштою — пас акаунта', async () => {
    const svc = createSimAuth();
    useAuthStore.getState().grantDevicePass('olena@example.com', 5);
    expect(svc.peek()).toMatchObject({ user: null, hasPass: true, passSince: 5, devicePass: { email: 'olena@example.com', since: 5 } });
    await svc.requestCode('olena@example.com', 'signin');
    await svc.verifyCode('olena@example.com', lastCode());
    expect(svc.peek()).toMatchObject({ user: { email: 'olena@example.com' }, hasPass: true, devicePass: null });
  });
});

describe('хуки сесії', () => {
  it('peek: увійшов — видно в першому ж кадрі після монтування; вихід — одразу', async () => {
    signIn('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    authSession.reset();
    const { result } = renderHook(() => ({ s: useSession(), pass: useHasPass() }));
    expect(result.current.s.session?.user?.email).toBe('olena@example.com');
    expect(result.current.pass).toBe(true);
    useAuthStore.getState().signOut();
    await waitFor(() => expect(result.current.s.session?.user).toBeNull());
    expect(result.current.pass).toBe(false);
  });
});

describe('кеш з peek', () => {
  it('підписка раніше за перший рендер (гідратація) — дані з peek, а не «loading» без сесії', () => {
    signIn('olena@example.com', 1);
    authSession.reset();
    const off = authSession.subscribe(() => undefined);
    expect(authSession.getSnapshot()).toMatchObject({ status: 'ready', data: { user: { email: 'olena@example.com' } } });
    off();
  });
});

describe('sim-адаптер профілю', () => {
  it('update: нік з прапором, визначений прапор, налаштування кабінету', async () => {
    const svc = createSimProfile();
    const res = await svc.update({ detectedFlag: 'PL', nick: 'Olena', flagCode: 'UA', settings: { hour12: true } });
    expect(res.ok && res.value).toMatchObject({ nick: 'Olena', flagCode: 'UA', detectedFlag: 'PL', settings: { hour12: true } });
    expect(useAccountStore.getState().hour12).toBe(true);
  });

  it('зміна пошти — кодом на нову адресу; помилки ті самі, що й у входу', async () => {
    signIn('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    const svc = createSimProfile();
    expect(await svc.changeEmail('olena@example.com')).toEqual({ ok: false, error: { code: 'validation', reason: 'same-email' } });
    const sent = await svc.changeEmail('New@Example.com');
    expect(sent.ok && sent.value.pendingEmail).toMatchObject({ email: 'new@example.com', attemptsLeft: CODE_MAX_ATTEMPTS });
    // Код зміни пошти не впускає як код входу.
    expect((await createSimAuth().verifyCode('new@example.com', lastCode())).ok).toBe(false);
    const bad = await svc.confirmEmailChange(wrongOf(lastCode()));
    expect(!bad.ok && authCodeError(bad.error)).toBe('wrong-code');
    const ok = await svc.confirmEmailChange(lastCode());
    expect(ok.ok && ok.value.pendingEmail).toBeNull();
    expect(useAuthStore.getState().user?.email).toBe('new@example.com');
    expect(useAuthStore.getState().passes['new@example.com']).toBe(2);
  });

  it('видалення акаунта: акаунт, пас, дані гостя й налаштування — геть', async () => {
    signIn('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    useGuestStore.getState().setNick('Olena');
    useAccountStore.getState().set('hour12', true);
    await createSimProfile().deleteAccount();
    expect(useAuthStore.getState()).toMatchObject({ user: null, accounts: [], passes: {} });
    expect(useGuestStore.getState().nick).toBeUndefined();
    expect(useAccountStore.getState().hour12).toBe(false);
  });
});
