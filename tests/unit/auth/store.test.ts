import { beforeEach, describe, expect, it } from 'vitest';
import { isEmail, LETTER_TTL_MS, MAX_CODE_TRIES, RESEND_GAP_MS, SEND_WINDOW_MS } from '@/lib/auth/sim';
import { clearReturn, rememberReturn, returnPath } from '@/lib/auth/returnTo';
import { useAuthStore } from '@/stores/auth';

const T0 = Date.UTC(2026, 11, 31, 22, 0, 0);

function reset() {
  useAuthStore.setState({ user: null, accounts: [], letter: null, sends: [] });
}

describe('вхід (імітація): лист, код, посилання', () => {
  beforeEach(reset);

  it('перший вхід з новою адресою створює акаунт, повторний — ні', () => {
    const st = useAuthStore.getState();
    expect(st.sendLetter(' Olena@Example.com ', 'signin', T0)).toEqual({ ok: true });
    const code = useAuthStore.getState().letter!.code;
    expect(useAuthStore.getState().letter!.email).toBe('olena@example.com');
    const first = useAuthStore.getState().verifyCode(code, T0 + 1000);
    expect(first).toEqual({ ok: true, isNew: true, email: 'olena@example.com' });
    expect(useAuthStore.getState().user?.email).toBe('olena@example.com');

    useAuthStore.getState().signOut();
    useAuthStore.getState().sendLetter('olena@example.com', 'signin', T0 + 10 * 60_000 + 1);
    const again = useAuthStore.getState().verifyCode(useAuthStore.getState().letter!.code, T0 + 10 * 60_000 + 2);
    expect(again).toEqual({ ok: true, isNew: false, email: 'olena@example.com' });
  });

  it('невірний код — «не підходить», після 5 спроб код згорає', () => {
    useAuthStore.getState().sendLetter('a@b.co', 'signin', T0);
    const right = useAuthStore.getState().letter!.code;
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 1; i < MAX_CODE_TRIES; i++) expect(useAuthStore.getState().verifyCode(wrong, T0)).toEqual({ ok: false, reason: 'wrong' });
    expect(useAuthStore.getState().verifyCode(wrong, T0)).toEqual({ ok: false, reason: 'burned' });
    expect(useAuthStore.getState().verifyCode(right, T0)).toEqual({ ok: false, reason: 'burned' });
  });

  it('код і посилання діють 15 хвилин і спрацьовують раз', () => {
    useAuthStore.getState().sendLetter('a@b.co', 'signin', T0);
    const { code, token } = useAuthStore.getState().letter!;
    expect(useAuthStore.getState().verifyCode(code, T0 + LETTER_TTL_MS + 1)).toEqual({ ok: false, reason: 'expired' });
    expect(useAuthStore.getState().openLink(token, T0 + 1000)).toMatchObject({ ok: true, isNew: true });
    expect(useAuthStore.getState().openLink(token, T0 + 2000)).toEqual({ ok: false, reason: 'expired', email: 'a@b.co' });
    expect(useAuthStore.getState().openLink('nope', T0)).toEqual({ ok: false, reason: 'none' });
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
    const { code } = useAuthStore.getState().letter!;
    expect(useAuthStore.getState().verifyCode(code, T0 + 1)).toEqual({ ok: false, reason: 'expired' });
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
