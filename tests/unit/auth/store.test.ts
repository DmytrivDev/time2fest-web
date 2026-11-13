import { simEmailSignIn } from '@/lib/api/sim/auth';
import { beforeEach, describe, expect, it } from 'vitest';
import { isEmail, LETTER_TTL_MS, RESEND_GAP_MS, SEND_WINDOW_MS } from '@/lib/auth/sim';
import { clearReturn, rememberReturn, returnPath } from '@/lib/auth/returnTo';
import { useAuthStore } from '@/stores/auth';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);

function reset() {
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [], passes: {} });
}

describe('вхід (імітація): без коду — нова адреса одразу, акаунт — посилання з листа', () => {
  beforeEach(reset);

  it('нова адреса: акаунт створено й людина увійшла одразу, лист «ти увійшов» з посиланням для інших пристроїв', () => {
    const res = simEmailSignIn(' Olena@Example.com ', 'signin', T0);
    expect(res).toEqual({ ok: true, sent: false, result: { ok: true, isNew: true, email: 'olena@example.com' } });
    expect(useAuthStore.getState().user?.email).toBe('olena@example.com');
    expect(useAuthStore.getState().letter).toMatchObject({ email: 'olena@example.com', welcome: true });
    // Лист «ти увійшов» не рахується в ліміт листів.
    expect(useAuthStore.getState().sends).toEqual([]);
  });

  it('адреса з акаунтом: лише посилання з листа — вхід після переходу за ним', () => {
    useAuthStore.setState({ accounts: ['olena@example.com'] });
    expect(simEmailSignIn('olena@example.com', 'signin', T0)).toEqual({ ok: true, sent: true });
    expect(useAuthStore.getState().user).toBeNull();
    const { token } = useAuthStore.getState().letter!;
    expect(useAuthStore.getState().openLink(token, T0 + 1000)).toEqual({ ok: true, isNew: false, email: 'olena@example.com' });
    expect(useAuthStore.getState().user?.email).toBe('olena@example.com');
  });

  it('посилання діє 15 хвилин і спрацьовує раз', () => {
    useAuthStore.setState({ accounts: ['a@b.co'] });
    simEmailSignIn('a@b.co', 'signin', T0);
    const { token } = useAuthStore.getState().letter!;
    expect(useAuthStore.getState().openLink(token, T0 + LETTER_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired', email: 'a@b.co' });
    useAuthStore.getState().sendLetter('a@b.co', 'signin', T0 + RESEND_GAP_MS);
    const fresh = useAuthStore.getState().letter!.token;
    expect(useAuthStore.getState().openLink(fresh, T0 + RESEND_GAP_MS + 1)).toMatchObject({ ok: true, isNew: false });
    expect(useAuthStore.getState().openLink(fresh, T0 + RESEND_GAP_MS + 2)).toEqual({ ok: false, reason: 'expired', email: 'a@b.co' });
    expect(useAuthStore.getState().openLink('nope', T0)).toEqual({ ok: false, reason: 'none' });
  });

  it('адреса з акаунтом: лист щойно надіслано — «зачекай»', () => {
    useAuthStore.setState({ accounts: ['a@b.co'] });
    simEmailSignIn('a@b.co', 'signin', T0);
    expect(simEmailSignIn('a@b.co', 'signin', T0 + 1000)).toEqual({ ok: false, reason: 'wait', until: T0 + RESEND_GAP_MS });
  });

  it('новий лист — не частіше ніж раз на хвилину; 4-й за 10 хвилин — «забагато спроб»', () => {
    const st = () => useAuthStore.getState();
    expect(st().sendLetter('a@b.co', 'signin', T0)).toEqual({ ok: true });
    expect(st().sendLetter('a@b.co', 'signin', T0 + 1000)).toEqual({ ok: false, reason: 'wait', until: T0 + RESEND_GAP_MS });
    expect(st().sendLetter('a@b.co', 'signin', T0 + RESEND_GAP_MS)).toEqual({ ok: true });
    expect(st().sendLetter('a@b.co', 'signin', T0 + 2 * RESEND_GAP_MS)).toEqual({ ok: true });
    expect(st().sendLetter('a@b.co', 'signin', T0 + 3 * RESEND_GAP_MS)).toEqual({
      ok: false,
      reason: 'too-many',
      until: T0 + SEND_WINDOW_MS,
    });
    expect(st().sendLetter('a@b.co', 'signin', T0 + SEND_WINDOW_MS)).toEqual({ ok: true });
  });

  it('Google — одразу вхід; прострочений лист з тестової пошти', () => {
    expect(useAuthStore.getState().signInGoogle(T0)).toMatchObject({ ok: true, isNew: true });
    useAuthStore.getState().sendLetter('a@b.co', 'signin', T0);
    useAuthStore.getState().expireLetter();
    const { token } = useAuthStore.getState().letter!;
    expect(useAuthStore.getState().openLink(token, T0 + 1)).toEqual({ ok: false, reason: 'expired', email: 'a@b.co' });
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
