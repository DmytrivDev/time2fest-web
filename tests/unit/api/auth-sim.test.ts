/** Шов E3: адаптери `sim` входу й профілю — тонкі обгортки над сторами; правило пошти — лише в `lib/api/sim/auth`. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { createSimAuth, NEW_EMAIL_SIGNS_IN_AT_ONCE, simSignInAfterPurchase } from '@/lib/api/sim/auth';
import { createSimProfile } from '@/lib/api/sim/profile';
import { authSession, useHasPass, useSession } from '@/lib/api/hooks/auth';
import { GOOGLE_DELAY_MS, RESEND_GAP_MS } from '@/lib/auth/sim';
import { useAccountStore } from '@/stores/account';
import { useAuthStore } from '@/stores/auth';
import { useGuestStore } from '@/stores/guest';
import { useTestControls } from '@/stores/testControls';

beforeEach(() => {
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {}, pendingPassGift: null });
  useTestControls.setState({ authUnavailable: false, googleCancelled: false });
});
afterEach(() => vi.useRealTimers());

describe('sim-адаптер входу', () => {
  it('правило пошти (рішення 2026-10-30): нова — одразу вхід + лист «ти увійшов»; з акаунтом — лише посилання', async () => {
    expect(NEW_EMAIL_SIGNS_IN_AT_ONCE).toBe(true);
    const svc = createSimAuth();
    const first = await svc.emailSignIn(' New@Example.com ', 'signup');
    expect(first).toEqual({ ok: true, value: { kind: 'signed-in', isNew: true, email: 'new@example.com' } });
    expect(useAuthStore.getState().letter?.welcome).toBe(true);
    await svc.signOut();
    const again = await svc.emailSignIn('new@example.com', 'signin');
    expect(again.ok && again.value.kind).toBe('link-sent');
    expect(useAuthStore.getState().user).toBeNull();
  });

  it('ліміт листів → rate_limited з причиною й часом; сервіс недоступний → unavailable', async () => {
    useAuthStore.setState({ accounts: ['a@b.co'] });
    const svc = createSimAuth();
    await svc.emailSignIn('a@b.co', 'signin');
    const wait = await svc.emailSignIn('a@b.co', 'signin');
    expect(wait.ok).toBe(false);
    if (!wait.ok) {
      expect(wait.error).toMatchObject({ code: 'rate_limited', reason: 'wait' });
      expect(wait.error.retryAfterMs).toBeGreaterThan(RESEND_GAP_MS - 1000);
    }
    useTestControls.setState({ authUnavailable: true });
    expect(await svc.emailSignIn('x@y.co', 'signin')).toEqual({ ok: false, error: { code: 'unavailable' } });
  });

  it('посилання з листа: вхід, повтор — прострочене, чужий токен — invalid', async () => {
    useAuthStore.setState({ accounts: ['a@b.co'] });
    const svc = createSimAuth();
    const sent = await svc.sendLink('a@b.co', 'signin');
    expect(sent.ok && sent.value.resendAt - sent.value.sentAt).toBe(RESEND_GAP_MS);
    const token = useAuthStore.getState().letter!.token;
    expect(await svc.openLink(token)).toEqual({ ok: true, value: { kind: 'signed-in', isNew: false, email: 'a@b.co' } });
    expect(await svc.openLink(token)).toEqual({ ok: true, value: { kind: 'expired', email: 'a@b.co' } });
    expect(await svc.openLink('nope')).toEqual({ ok: true, value: { kind: 'invalid' } });
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
    simSignInAfterPurchase('Olena@Example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    off();
    expect(seen.at(-1)).toBe(true);
    expect(svc.peek()).toMatchObject({ user: { email: 'olena@example.com' }, hasPass: true, passSince: 2 });
    expect(svc.peek()).toBe(svc.peek());
  });
});

describe('хуки сесії', () => {
  it('peek: увійшов — видно в першому ж кадрі після монтування; вихід — одразу', async () => {
    simSignInAfterPurchase('olena@example.com', 1);
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
    simSignInAfterPurchase('olena@example.com', 1);
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

  it('видалення акаунта: акаунт, пас, дані гостя й налаштування — геть', async () => {
    simSignInAfterPurchase('olena@example.com', 1);
    useAuthStore.getState().grantPass('olena@example.com', 2);
    useGuestStore.getState().setNick('Olena');
    useAccountStore.getState().set('hour12', true);
    await createSimProfile().deleteAccount();
    expect(useAuthStore.getState()).toMatchObject({ user: null, accounts: [], passes: {} });
    expect(useGuestStore.getState().nick).toBeUndefined();
    expect(useAccountStore.getState().hour12).toBe(false);
  });
});
